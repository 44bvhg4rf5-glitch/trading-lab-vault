import json
import shutil
import unittest

from pm import paths
from pm.config import Config
from pm.state import State, save_state
from pm.venues.smarkets import SmarketsVenue, snap_price_bps


class SmarketsMappingTests(unittest.TestCase):
    def setUp(self):
        self.v = SmarketsVenue(Config(raw={"venue": "smarkets"}))
        # contract 1: backs resting at 40% (bids), lays resting at 42% (offers); pot in 1/10000 GBP
        self.v._quotes["1"] = {"bids": [{"price": 4000, "quantity": 500000}, {"price": 3900, "quantity": 100000}],
                               "offers": [{"price": 4200, "quantity": 250000}]}
        self.v._contract_market["1"] = "m1"

    def test_back_book(self):
        b = self.v.get_book("1")
        self.assertAlmostEqual(b.best_bid, 0.40)
        self.assertAlmostEqual(b.best_ask, 0.42)
        self.assertAlmostEqual(b.asks[0].size, 25.0)      # £250,000/10000 pot units -> 25 "shares"
        self.assertAlmostEqual(b.mid, 0.41)

    def test_lay_book_is_inverted(self):
        b = self.v.get_book("lay:1")
        # buying NO = laying into resting backs at 40% -> NO costs 0.60
        self.assertAlmostEqual(b.best_ask, 0.60)
        self.assertAlmostEqual(b.asks[0].size, 50.0)
        # selling NO = backing into resting lays at 42% -> NO bid 0.58
        self.assertAlmostEqual(b.best_bid, 0.58)

    def test_yes_no_market_and_exclusive_markets(self):
        self.v._events["e"] = {"id": "e", "name": "Event", "start_datetime": "2027-01-01T00:00:00Z"}
        m = {"id": "m1", "event_id": "e", "name": "Q?", "winner_count": 1}
        self.v._quotes["2"] = {"bids": [{"price": 5800, "quantity": 10000}], "offers": [{"price": 6000, "quantity": 10000}]}
        made = self.v._to_markets(m, [{"id": "1", "name": "Yes"}, {"id": "2", "name": "No"}], 100.0)
        self.assertEqual(len(made), 1)
        self.assertEqual(made[0].token_ids, ["1", "2"])
        self.assertFalse(made[0].neg_risk)
        made = self.v._to_markets(m, [{"id": "1", "name": "Labour"}, {"id": "2", "name": "Tory"}], 100.0)
        self.assertEqual(len(made), 2)
        self.assertTrue(all(x.neg_risk and x.event_id == "m1" for x in made))
        self.assertEqual(made[0].token_ids, ["1", "lay:1"])

    def test_snap_price_ladder(self):
        # 40% -> odds 2.5 (tick 0.02) exact
        self.assertEqual(snap_price_bps(0.40, "buy"), 4000)
        # 0.333 -> odds 3.003; buy floors odds to 3.0 -> 3333; sell ceils to 3.05 -> 3279
        self.assertEqual(snap_price_bps(1 / 3.003, "buy"), 3333)
        self.assertEqual(snap_price_bps(1 / 3.003, "sell"), 3279)
        self.assertTrue(1 <= snap_price_bps(0.999, "buy") <= 9999)


class WithdrawTests(unittest.TestCase):
    def setUp(self):
        paths.use_venue("_test_withdraw")
        shutil.rmtree(paths.state_dir(), ignore_errors=True)
        st = State(created_at="x", initial_bankroll_usd=50, cash_usd=50, hwm_usd=60, gbp_usd=1.0, currency="GBP")
        st.reserves = {"tools": 4.0, "owner": 2.0}
        save_state(st)

    def tearDown(self):
        shutil.rmtree(paths.state_dir(), ignore_errors=True)
        paths.use_venue("polymarket")

    def test_withdraw_reduces_pot_and_journals(self):
        from pm import engine
        cfg = Config(raw={"venue": "smarkets"})
        rec = engine.withdraw(cfg, "tools", 1.5, "test")
        self.assertAlmostEqual(rec["remaining_gbp"], 2.5)
        with open(paths.state_dir() / "journal.jsonl", encoding="utf-8") as fh:
            rows = [json.loads(l) for l in fh]
        self.assertEqual(rows[-1]["type"], "withdrawal")
        with self.assertRaises(ValueError):
            engine.withdraw(cfg, "owner", 5.0)


if __name__ == "__main__":
    unittest.main()
