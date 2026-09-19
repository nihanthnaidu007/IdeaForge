"""Vault crypto: AES-256-GCM round-trip, tamper/foreign-AAD rejection, masking.

Spec verification criterion #3: encrypt→decrypt round-trip; tampered ciphertext
or foreign AAD fails; no API response ever contains key material (hint only).
"""

from __future__ import annotations

import base64

import pytest
from app.services.vault import (
    VaultDecryptionError,
    VaultValidationError,
    decrypt_secret,
    encrypt_secret,
    hint,
    subkey,
)

from tests.conftest import VALID_MASTER_KEY

MASTER = base64.b64decode(VALID_MASTER_KEY)
KEY = "sk-openai-test-key-xyz99"


def test_round_trip_restores_plaintext() -> None:
    blob = encrypt_secret(MASTER, "user-1", "openai", KEY)
    assert decrypt_secret(MASTER, "user-1", "openai", blob) == KEY


def test_blob_never_contains_plaintext() -> None:
    blob = encrypt_secret(MASTER, "user-1", "openai", KEY)
    assert KEY not in repr(blob)
    assert len(base64.b64decode(str(blob["nonce"]))) == 12  # 96-bit nonce
    assert blob["key_version"] == 1
    assert blob["alg"] == "AES-256-GCM"


def test_tampered_ciphertext_fails() -> None:
    blob = encrypt_secret(MASTER, "user-1", "openai", KEY)
    ct = bytearray(base64.b64decode(str(blob["ciphertext"])))
    ct[0] ^= 0xFF  # flip one bit
    blob["ciphertext"] = base64.b64encode(bytes(ct)).decode()
    with pytest.raises(VaultDecryptionError):
        decrypt_secret(MASTER, "user-1", "openai", blob)


def test_foreign_user_aad_fails() -> None:
    """A blob copied into another user's document must not decrypt."""
    blob = encrypt_secret(MASTER, "user-1", "openai", KEY)
    with pytest.raises(VaultDecryptionError):
        decrypt_secret(MASTER, "user-2", "openai", blob)


def test_foreign_provider_aad_fails() -> None:
    """A blob swapped across providers must not decrypt."""
    blob = encrypt_secret(MASTER, "user-1", "openai", KEY)
    with pytest.raises(VaultDecryptionError):
        decrypt_secret(MASTER, "user-1", "anthropic", blob)


def test_rotated_master_key_fails() -> None:
    blob = encrypt_secret(MASTER, "user-1", "openai", KEY)
    rotated = base64.b64encode(b"1" * 32).decode("ascii")
    with pytest.raises(VaultDecryptionError):
        decrypt_secret(base64.b64decode(rotated), "user-1", "openai", blob)


def test_encrypt_rejects_degenerate_secrets() -> None:
    """L7: the vault enforces the key-shape floor itself — a too-short secret
    is never encrypted, even if a caller skips its own validation."""
    for plaintext in ("", "short", "x" * 7):
        with pytest.raises(VaultValidationError):
            encrypt_secret(MASTER, "user-1", "openai", plaintext)


def test_nonce_is_fresh_per_encryption() -> None:
    first = encrypt_secret(MASTER, "user-1", "openai", KEY)
    second = encrypt_secret(MASTER, "user-1", "openai", KEY)
    assert first["nonce"] != second["nonce"]


def test_subkeys_differ_per_provider_but_are_deterministic() -> None:
    assert subkey(MASTER, "openai") != subkey(MASTER, "anthropic")
    assert subkey(MASTER, "openai") == subkey(MASTER, "openai")


def test_hint_masks_all_but_last_four() -> None:
    assert hint(KEY) == "****yz99"
