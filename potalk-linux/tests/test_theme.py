"""テーマの純粋な部分（解決ロジックとパレット）のテスト。Qt は使わない。"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from potalk_linux import theme  # noqa: E402


class ResolveTest(unittest.TestCase):
    def test_explicit_modes(self):
        self.assertEqual(theme.resolve("light", True), "light")
        self.assertEqual(theme.resolve("light", False), "light")
        self.assertEqual(theme.resolve("dark", True), "dark")
        self.assertEqual(theme.resolve("dark", False), "dark")

    def test_system_follows_os(self):
        self.assertEqual(theme.resolve("system", True), "dark")
        self.assertEqual(theme.resolve("system", False), "light")

    def test_unknown_mode_falls_back_to_system(self):
        self.assertEqual(theme.resolve("???", True), "dark")
        self.assertEqual(theme.resolve("", False), "light")


class PaletteTest(unittest.TestCase):
    KEYS = {"bg", "card", "text", "dim", "accent", "warn", "danger", "chip_bg", "sel_border"}

    def test_both_palettes_have_all_keys(self):
        for name, pal in theme.PALETTES.items():
            with self.subTest(palette=name):
                self.assertTrue(self.KEYS.issubset(pal.keys()))
                for v in pal.values():
                    self.assertTrue(v.startswith("#") and len(v) == 7, v)

    def test_qss_uses_palette_colors(self):
        for pal in theme.PALETTES.values():
            qss = theme.build_qss(pal)
            self.assertIn(pal["bg"], qss)
            self.assertIn(pal["warn"], qss)
            self.assertIn("warnButton", qss)
            self.assertIn("dangerButton", qss)
            self.assertIn("pillLabel", qss)

    def test_dark_and_light_differ(self):
        self.assertNotEqual(theme.LIGHT["bg"], theme.DARK["bg"])
        self.assertNotEqual(theme.LIGHT["text"], theme.DARK["text"])


if __name__ == "__main__":
    unittest.main()
