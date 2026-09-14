import unittest

from pm.kelly import Commission, FeeModel, TakerFee, decide, expected_log_growth, kelly_fraction


class KellyTests(unittest.TestCase):
    def test_taker_fee_peaks_at_half(self):
        self.assertAlmostEqual(TakerFee(0.07).per_share(0.5), 0.0175)
        self.assertLess(TakerFee(0.07).per_share(0.9), TakerFee(0.07).per_share(0.5))

    def test_kelly_formula(self):
        # p=0.6 at cost 0.5 (net odds 1) -> 0.6 - 0.4/1 = 0.2
        self.assertAlmostEqual(kelly_fraction(0.6, 1.0), 0.2)
        self.assertEqual(kelly_fraction(0.4, 1.0), 0.0)

    def test_min_edge_gate_uses_fees(self):
        # 8% raw edge but a taker fee eats into it at price 0.5
        d = decide(0.58, 0.50, 0.50, bankroll=100, fee=TakerFee(0.07), fraction=0.25,
                   min_edge=0.08, max_stake=100)
        self.assertIsNone(d)
        d = decide(0.58, 0.50, 0.50, bankroll=100, fee=FeeModel(), fraction=0.25,
                   min_edge=0.08, max_stake=100)
        self.assertIsNotNone(d)
        self.assertEqual(d.side, "YES")

    def test_commission_model(self):
        c = Commission(0.02)
        # backing at 0.5: net odds 1 * 0.98; breakeven 1/(1.98) = 0.50505
        self.assertAlmostEqual(c.breakeven(0.5), 1 / 1.98)
        self.assertAlmostEqual(c.settle(10.0, 6.0), 10.0 - 0.02 * 4.0)   # 2% of profit
        self.assertAlmostEqual(c.settle(4.0, 6.0), 4.0)                  # no fee on a loss
        self.assertEqual(c.entry_fee(0.5, 10), 0.0)

    def test_picks_no_side(self):
        d = decide(0.20, 0.35, 0.66, bankroll=100, fee=FeeModel(), fraction=0.5,
                   min_edge=0.08, max_stake=100)
        self.assertEqual(d.side, "NO")
        self.assertAlmostEqual(d.edge, 0.80 - 0.66)
        self.assertAlmostEqual(d.kelly_full, (0.80 - 0.66) / (1 - 0.66))
        self.assertAlmostEqual(d.stake_usd, d.kelly_full * 0.5 * 100)

    def test_stake_capped(self):
        d = decide(0.9, 0.5, 0.5, bankroll=1000, fee=FeeModel(), fraction=1.0,
                   min_edge=0.08, max_stake=7.5)
        self.assertAlmostEqual(d.stake_usd, 7.5)

    def test_growth_positive_at_fractional_kelly(self):
        g = expected_log_growth(0.58, 0.5, 0.04)
        self.assertGreater(g, 0)
        self.assertGreater(expected_log_growth(0.58, 0.5, 0.16), g)


if __name__ == "__main__":
    unittest.main()
