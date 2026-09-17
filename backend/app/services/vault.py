"""BYOK key vault — AES-256-GCM envelope encryption (spec §Security floor).

Design properties that matter for a multi-tenant key store:
- HKDF subkeys per provider (the master key is high-entropy, so HKDF — not PBKDF2).
- AAD binds every ciphertext to ``user_id:provider`` — a blob copied into another
  user's document (or swapped across providers) fails decryption instead of
  silently working.
- The ONLY key material any API response may show is the masked hint.
"""

from __future__ import annotations

import base64
import os
from typing import Protocol, runtime_checkable

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

_KEY_INFO_PREFIX = b"ideaforge/byok/v1/"
_KEY_VERSION = 1
_ALG = "AES-256-GCM"


class VaultDecryptionError(Exception):
    """Ciphertext failed to decrypt (tampered, foreign AAD, or rotated master key)."""


class VaultValidationError(Exception):
    """Plaintext rejected before encryption (fails the key-shape floor)."""


# Defense-in-depth floor matching the router's minimum key length: nothing —
# not even a caller that forgets to validate — may encrypt a degenerate secret
# into the vault (L7).
_MIN_PLAINTEXT_LENGTH = 8


def subkey(master: bytes, provider: str) -> bytes:
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=_KEY_INFO_PREFIX + provider.encode(),
    ).derive(master)


def encrypt_secret(
    master: bytes, user_id: str, provider: str, plaintext: str
) -> dict[str, object]:
    if len(plaintext) < _MIN_PLAINTEXT_LENGTH:
        raise VaultValidationError(
            "API key too short to be valid — not encrypting into the vault."
        )
    nonce = os.urandom(12)  # fresh per encryption, always
    aad = f"{user_id}:{provider}".encode()
    ciphertext = AESGCM(subkey(master, provider)).encrypt(
        nonce, plaintext.encode(), aad
    )
    return {
        "nonce": base64.b64encode(nonce).decode(),
        "ciphertext": base64.b64encode(ciphertext).decode(),
        "key_version": _KEY_VERSION,
        "alg": _ALG,
    }


def decrypt_secret(
    master: bytes, user_id: str, provider: str, blob: dict[str, object]
) -> str:
    try:
        nonce = base64.b64decode(str(blob["nonce"]))
        ciphertext = base64.b64decode(str(blob["ciphertext"]))
        aad = f"{user_id}:{provider}".encode()
        plaintext = AESGCM(subkey(master, provider)).decrypt(nonce, ciphertext, aad)
        return plaintext.decode()
    except (KeyError, ValueError, InvalidTag) as exc:
        raise VaultDecryptionError(
            "Stored API key failed to decrypt — it may have been saved with a "
            "different master key or corrupted."
        ) from exc


def hint(plaintext: str) -> str:
    """The masked form — the only thing responses may ever show."""
    return "****" + plaintext[-4:]


@runtime_checkable
class Vault(Protocol):
    def encrypt(self, user_id: str, provider: str, plaintext: str) -> dict[str, object]: ...

    def decrypt(self, user_id: str, provider: str, blob: dict[str, object]) -> str: ...

    @staticmethod
    def masked(plaintext: str) -> str: ...


class AESGCMVault:
    """Concrete vault bound to one server master key."""

    def __init__(self, master_key_b64: str) -> None:
        self._master = base64.b64decode(master_key_b64)

    def encrypt(self, user_id: str, provider: str, plaintext: str) -> dict[str, object]:
        blob = encrypt_secret(self._master, user_id, provider, plaintext)
        blob["hint"] = hint(plaintext)
        return blob

    def decrypt(self, user_id: str, provider: str, blob: dict[str, object]) -> str:
        return decrypt_secret(self._master, user_id, provider, blob)

    @staticmethod
    def masked(plaintext: str) -> str:
        return hint(plaintext)


def build_vault(master_key_b64: str) -> Vault:
    return AESGCMVault(master_key_b64)
