import unittest
from datetime import datetime, timedelta, timezone

from pm.calibration import score, skill_weights
from pm.clients.clob import Book, Level
from pm.clients.gamma import Market
from pm.research.agents import EventConsistencyAgent, OrderBookAgent, TimeDecayAgent
from pm.research.base import Estimate, MarketContext
from pm.research.ensemble import combine
from pm.research.text import compatible, entity_terms, implies_deadline, jaccard, keywords


def market(question="Will X happen by September 30?", mid=0.2, neg_risk=False, hours=48, event="e"):
    now = datetime.now(timezone.utc)
    return Market(id="1", condition_id="c", question=question, slug="s", description="", outcomes=["Yes", "No"],
                  outcome_prices=[mid, 1 - mid], token_ids=["y", "n"], end_date=now + timedelta(hours=hours),
                  liquidity=1e5, volume_24h=1e4, neg_risk=neg_risk, active=True, closed=False,
                  accepting_orders=True, min_order_size=5, tick=0.01, event_id=event)


def book(bid, ask, bid_size=1000, ask_size=1000):
    return Book("t", bids=[Level(bid, bid_size)], asks=[Level(ask, ask_size)])


def ctx(m, byes, sibs=None, sib_mids=None, history=None):
    return MarketContext(market=m, book_yes=byes, book_no=book(1 - byes.best_ask, 1 - byes.best_bid),
                         siblings=sibs or [], sibling_mids=sib_mids or {}, history=history or [],
                         now=datetime.now(timezone.utc), headline_loader=lambda: [])


class BookTests(unittest.TestCase):
    def test_fill_walks_levels(self):
        b = Book("t", asks=[Level(0.10, 10), Level(0.12, 100)])
        shares, avg = b.fill_cost(5.0)
        # 10 shares @0.10 = $1, then $4 @0.12 = 33.33 shares
        self.assertAlmostEqual(shares, 10 + 4 / 0.12)
        self.assertAlmostEqual(avg, 5.0 / shares)

    def test_sell_walks_bids(self):
        b = Book("t", bids=[Level(0.5, 4), Level(0.4, 100)])
        proceeds, avg = b.sell_proceeds(10)
        self.assertAlmostEqual(proceeds, 4 * 0.5 + 6 * 0.4)


class AgentTests(unittest.TestCase):
    def test_event_consistency_normalises(self):
        m = market(mid=0.30, neg_risk=True)
        sib = market(question="other", mid=0.85)
        c = ctx(m, book(0.29, 0.31), sibs=[sib], sib_mids={"2": 0.85})
        e = EventConsistencyAgent().estimate(c)
        self.assertIsNotNone(e)
        self.assertAlmostEqual(e.p, 0.30 / 1.15, places=3)
        self.assertGreater(e.confidence, 0.5)

    def test_event_consistency_silent_when_consistent(self):
        m = market(mid=0.30, neg_risk=True)
        c = ctx(m, book(0.29, 0.31), sibs=[market(mid=0.7)], sib_mids={"2": 0.70})
        e = EventConsistencyAgent().estimate(c)
        self.assertTrue(e is None or e.p is None)

    def test_pair_arb_flag(self):
        m = market(mid=0.5)
        c = MarketContext(market=m, book_yes=book(0.45, 0.47), book_no=book(0.50, 0.51), siblings=[],
                          sibling_mids={}, history=[], now=datetime.now(timezone.utc))
        e = EventConsistencyAgent().estimate(c)
        self.assertIn("pair-arb: yes_ask+no_ask=0.980", e.flags)

    def test_orderbook_microprice(self):
        m = market(mid=0.5)
        c = ctx(m, book(0.49, 0.51, bid_size=3000, ask_size=1000))
        e = OrderBookAgent().estimate(c)
        self.assertGreater(e.p, 0.50)

    def test_time_decay_only_on_deadline_markets(self):
        m = market(question="Will the Fed cut rates?", mid=0.2, hours=24)
        self.assertIsNone(TimeDecayAgent().estimate(ctx(m, book(0.19, 0.21))))
        m = market(question="Will X happen by Sept 30?", mid=0.2, hours=24)
        e = TimeDecayAgent().estimate(ctx(m, book(0.19, 0.21)))
        self.assertIsNotNone(e)
        self.assertLess(e.p, 0.2)


class EnsembleTests(unittest.TestCase):
    def test_no_agents_returns_market(self):
        r = combine(0.4, [], {})
        self.assertAlmostEqual(r.p, 0.4)
        self.assertEqual(r.confidence, 0.0)

    def test_agreement_moves_toward_agents(self):
        ests = [Estimate("a", 0.7, 1.0, ""), Estimate("b", 0.7, 1.0, "")]
        r = combine(0.4, ests, {"a": 1, "b": 1})
        self.assertGreater(r.p, 0.4)
        self.assertLess(r.p, 0.7)

    def test_disagreement_shrinks_to_market(self):
        agree = combine(0.4, [Estimate("a", 0.7, 1.0, ""), Estimate("b", 0.7, 1.0, "")], {"a": 1, "b": 1})
        disagree = combine(0.4, [Estimate("a", 0.9, 1.0, ""), Estimate("b", 0.5, 1.0, "")], {"a": 1, "b": 1})
        self.assertLess(disagree.confidence, agree.confidence)

    def test_news_uncertainty_lowers_confidence(self):
        base = [Estimate("a", 0.7, 1.0, ""), Estimate("b", 0.7, 1.0, "")]
        calm = combine(0.4, base, {"a": 1, "b": 1})
        storm = combine(0.4, base + [Estimate("news", None, 0.0, "", uncertainty=0.5)], {"a": 1, "b": 1})
        self.assertLess(storm.confidence, calm.confidence)


class CalibrationTests(unittest.TestCase):
    def test_skill_weights_reward_beating_market(self):
        cal = {"agents": {}, "market": {"n": 0, "brier": 0.0}, "ensemble": {"n": 0, "brier": 0.0}}
        for _ in range(40):
            score(cal, {"market_p": 0.5, "ensemble_p": 0.6, "estimates": [{"agent": "good", "p": 0.9},
                                                                            {"agent": "bad", "p": 0.1}]}, 1)
        w = skill_weights(cal, {"good": 1.0, "bad": 1.0, "new": 1.0})
        self.assertGreater(w["good"], 1.0)
        self.assertLess(w["bad"], 1.0)
        self.assertEqual(w["new"], 1.0)


class TextTests(unittest.TestCase):
    def test_keywords_and_similarity(self):
        self.assertIn("fed", keywords("Will the Fed cut rates in September?"))
        self.assertGreater(jaccard("Will the Fed cut rates in September?", "Fed rate cut September?"), 0.5)
        self.assertTrue(implies_deadline("Will Bitcoin hit $100k by October 31?"))
        self.assertFalse(implies_deadline("Who will win the election?"))

    def test_entity_terms(self):
        self.assertEqual(entity_terms("Will the Fed increase interest rates by 25 bps after the September 2026 meeting?"),
                         "Fed 25 September 2026")

    def test_compatible_rejects_opposites(self):
        self.assertFalse(compatible("Will there be no change in Fed interest rates after the September meeting?",
                                    "Will the Fed raise interest rates in September 2026?")[0])
        self.assertFalse(compatible("Will the Fed increase rates by 25 bps?", "Will the Fed cut rates by 25 bps?")[0])
        self.assertFalse(compatible("Will Bitcoin reach $80,000 in September?", "Will Bitcoin reach $100,000 in September?")[0])
        self.assertTrue(compatible("Will the Fed decrease interest rates by 25 bps after the September 2026 meeting?",
                                   "Will the Fed cut rates by 25 bps at its next meeting?")[0])


if __name__ == "__main__":
    unittest.main()
