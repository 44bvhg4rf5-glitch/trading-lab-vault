import unittest
from datetime import datetime, timezone

from pm.config import Config
from pm.risk import floor_usd, position_caps, snapshot
from pm.state import Position, State
from pm.treasury import maybe_distribute

CFG = Config(raw={"risk": {"initial_max_drawdown": 0.2, "trailing_drawdown": 0.1, "daily_loss_halt": 0.05,
                           "max_total_exposure_frac": 0.6, "max_position_frac": 0.15, "max_event_frac": 0.25},
                  "split": {"reinvest": 0.4, "tools": 0.4, "owner": 0.2}, "split_min_profit_usd": 5})


def mk_state(cash=65.0, initial=65.0, hwm=65.0):
    return State(created_at="x", initial_bankroll_usd=initial, cash_usd=cash, hwm_usd=hwm)


def pos(cost, market="m1", event=None, token="t"):
    return Position(id="p", market_id=market, condition_id="c", question="q", side="YES", token_id=token,
                    shares=cost / 0.5, avg_price=0.5, cost_usd=cost, opened_at="x", p_est=0.6, edge=0.1,
                    event_id=event)


class RiskTests(unittest.TestCase):
    def test_floor_initial(self):
        st = mk_state()
        self.assertAlmostEqual(floor_usd(CFG, st), 52.0)

    def test_floor_ratchets_with_hwm(self):
        st = mk_state(cash=120, hwm=120)
        self.assertAlmostEqual(floor_usd(CFG, st), 52.0 + 55.0 * 0.9)  # 90% of gains locked

    def test_budget_is_equity_minus_floor_minus_exposure(self):
        st = mk_state()
        st.positions.append(pos(8.0))
        st.cash_usd -= 8.0
        s = snapshot(CFG, st)
        self.assertAlmostEqual(s.equity, 65.0)
        self.assertAlmostEqual(s.budget, 65 - 52 - 8)

    def test_worst_case_never_breaches_floor(self):
        st = mk_state()
        s = snapshot(CFG, st)
        # spend the whole budget, then mark everything to zero
        st.positions.append(pos(s.budget))
        st.cash_usd -= s.budget
        eq_after_wipeout = st.equity_usd({"t": 0.0})
        self.assertGreaterEqual(eq_after_wipeout + 1e-9, floor_usd(CFG, st))
        self.assertAlmostEqual(snapshot(CFG, st).budget, 0.0)

    def test_daily_halt(self):
        st = mk_state()
        st.daily = {"date": datetime.now(timezone.utc).date().isoformat(), "start_equity": 70.0}
        s = snapshot(CFG, st)
        self.assertTrue(s.halted)
        self.assertEqual(s.budget, 0.0)

    def test_event_cap(self):
        st = mk_state(cash=100, initial=100, hwm=100)
        st.positions.append(pos(20.0, market="a", event="e1"))
        cap = position_caps(CFG, st, 100.0, "e1", "b")
        self.assertAlmostEqual(cap, 5.0)  # 25% event cap - 20 already


class TreasuryTests(unittest.TestCase):
    def test_no_split_below_threshold(self):
        st = mk_state(cash=68.0)
        self.assertIsNone(maybe_distribute(CFG, st, 68.0))

    def test_split_40_40_20(self):
        st = mk_state(cash=75.0)  # +10 realised profit
        d = maybe_distribute(CFG, st, 75.0)
        self.assertIsNotNone(d)
        self.assertAlmostEqual(d.profit, 10.0)
        self.assertAlmostEqual(d.tools, 4.0)
        self.assertAlmostEqual(d.owner, 2.0)
        self.assertAlmostEqual(d.reinvest, 4.0)
        self.assertAlmostEqual(st.cash_usd, 69.0)          # 75 - 6 banked
        self.assertAlmostEqual(st.reserves["tools"], 4.0)
        self.assertAlmostEqual(st.reserves["owner"], 2.0)
        # second call: nothing new to split
        self.assertIsNone(maybe_distribute(CFG, st, 69.0))

    def test_split_ignores_unrealised(self):
        st = mk_state(cash=60.0)
        st.positions.append(pos(5.0))
        # equity marked high, but positions at cost -> no realised profit
        self.assertIsNone(maybe_distribute(CFG, st, 90.0))


if __name__ == "__main__":
    unittest.main()
