import unittest
from pathlib import Path

from recovery import LIMIT, allowed, folded_password, route


class Names(unittest.TestCase):
    def test_the_yoniq_shape(self):
        self.assertTrue(allowed("@LU1AQY31102026140509.BMP"))
        self.assertTrue(allowed("@W1AW/P31102026140509.BMP"))

    def test_rejects_anything_else(self):
        self.assertFalse(allowed("@LU1AQY31102026140509.bmp"))
        self.assertFalse(allowed("LU1AQY31102026140509.BMP"))
        self.assertFalse(allowed("@../x31102026140509.BMP"))
        self.assertFalse(allowed("@LU1AQY/P/Q31102026140509.BMP"))
        self.assertFalse(allowed("@LU1AQY.BMP"))
        self.assertLessEqual(LIMIT, 240)

    def test_password_is_not_plain_text(self):
        src = Path(__file__).with_name("recovery.py").read_text(encoding="utf-8")
        secret = folded_password()
        self.assertNotIn(secret, src)
        self.assertGreaterEqual(len(secret), 8)

    def test_the_page_prefix_is_stripped(self):
        self.assertEqual(route("/dgt/file/@LU1AQY31102026140509.BMP"), "/file/@LU1AQY31102026140509.BMP")
        self.assertEqual(route("/dgt/find"), "/find")
        self.assertEqual(route("/file/x"), "/file/x")


if __name__ == "__main__":
    unittest.main()
