import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import security as sec


class TotpTests(unittest.TestCase):
    # Vectores oficiales de RFC 6238 (SHA-1, secreto ASCII "12345678901234567890")
    SECRET_B32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

    def test_rfc6238_vectors(self):
        for t, expected8 in [(59, "94287082"), (1111111109, "07081804"), (1234567890, "89005924"), (2000000000, "69279037")]:
            self.assertEqual(sec.totp_at_counter(self.SECRET_B32, t // 30), expected8[-6:])

    def test_clock_skew_windows(self):
        now = 1_700_000_000
        code = sec.totp_now(self.SECRET_B32, now)
        self.assertEqual(sec.matching_window(self.SECRET_B32, code, now), 0)
        self.assertEqual(sec.matching_window(self.SECRET_B32, code, now + 30), -1)
        self.assertEqual(sec.matching_window(self.SECRET_B32, code, now - 30), 1)
        self.assertIsNone(sec.matching_window(self.SECRET_B32, code, now + 120))


class PkceTests(unittest.TestCase):
    def test_rfc7636_appendix_b(self):
        verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        self.assertEqual(sec.s256_challenge(verifier), challenge)
        self.assertTrue(sec.pkce_matches(verifier, challenge))
        self.assertFalse(sec.pkce_matches(verifier + "x", challenge))


class TokenTests(unittest.TestCase):
    def test_roundtrip_and_tamper(self):
        tok = sec.sign_token({"sub": "a", "typ": "access", "mfa_verified": False}, "k", 60)
        self.assertEqual(sec.verify_token(tok, "k", "access")["sub"], "a")
        with self.assertRaises(sec.TokenError):
            sec.verify_token(tok, "otra-clave")
        with self.assertRaises(sec.TokenError):
            sec.verify_token(tok, "k", "step_up")
        with self.assertRaises(sec.TokenError):
            sec.verify_token(sec.sign_token({"sub": "a", "typ": "access"}, "k", -1), "k")


if __name__ == "__main__":
    unittest.main()
