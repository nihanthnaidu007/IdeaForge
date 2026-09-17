"""Auth flow: register/login/me plus refresh rotation and revocation."""

from __future__ import annotations

import jwt

from tests.conftest import make_settings


async def _register(client, email: str, password: str = "correct-horse-9"):
    return await client.post(
        "/api/auth/register", json={"email": email, "password": password, "name": "C"}
    )

async def test_register_returns_tokens_and_user(client) -> None:
    response = await _register(client, "first@example.com")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["token"]
    assert body["refresh_token"]
    assert body["user"]["email"] == "first@example.com"
    assert "password" not in body["user"]

    claims = jwt.decode(
        body["token"],
        make_settings().jwt_secret,
        algorithms=["HS256"],
    )
    assert claims["type"] == "access"
    assert claims["email"] == "first@example.com"


async def test_duplicate_registration_returns_409(client) -> None:
    assert (await _register(client, "dupe@example.com")).status_code == 200
    second = await _register(client, "dupe@example.com")
    assert second.status_code == 409


async def test_register_rejects_short_password(client) -> None:
    response = await _register(client, "shortpw@example.com", password="short")
    assert response.status_code == 422


async def test_login_success_and_failure(client) -> None:
    await _register(client, "login@example.com")
    ok = await client.post(
        "/api/auth/login",
        json={"email": "login@example.com", "password": "correct-horse-9"},
    )
    assert ok.status_code == 200
    assert ok.json()["token"]

    bad = await client.post(
        "/api/auth/login",
        json={"email": "login@example.com", "password": "wrong-password-1"},
    )
    assert bad.status_code == 401

    unknown = await client.post(
        "/api/auth/login", json={"email": "ghost@example.com", "password": "whatever-1"}
    )
    assert unknown.status_code == 401


async def test_me_requires_and_honors_token(client) -> None:
    register = await _register(client, "me@example.com")
    token = register.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    me = await client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["email"] == "me@example.com"
    assert "password" not in me.json()

    assert (await client.get("/api/auth/me")).status_code == 403
    forged = await client.get(
        "/api/auth/me", headers={"Authorization": "Bearer not-a-real-token"}
    )
    assert forged.status_code == 401


async def test_logout_kills_outstanding_access_token(client) -> None:
    """H2: revocation semantics — logout bumps token_version, so a stolen
    bearer dies immediately instead of living out its TTL."""
    register = await _register(client, "revoke@example.com")
    token = register.json()["token"]
    refresh_token = register.json()["refresh_token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert (await client.get("/api/auth/me", headers=headers)).status_code == 200

    logout = await client.post("/api/auth/logout", json={"refresh_token": refresh_token})
    assert logout.status_code == 200

    after = await client.get("/api/auth/me", headers=headers)
    assert after.status_code == 401  # the access token is dead


async def test_access_token_carries_version_and_ids(client) -> None:
    register = await _register(client, "claims@example.com")
    claims = jwt.decode(
        register.json()["token"], make_settings().jwt_secret, algorithms=["HS256"]
    )
    assert claims["ver"] == 0
    assert claims["iat"]
    assert claims["jti"]

    # A token whose version lags the users doc is revoked (spec mechanism).
    stale = jwt.encode(
        {**claims, "ver": 5},
        make_settings().jwt_secret,
        algorithm="HS256",
    )
    response = await client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {stale}"}
    )
    assert response.status_code == 401


async def test_login_after_logout_mints_fresh_version(client) -> None:
    """The revocation kill-switch must not lock the legitimate user out."""
    register = await _register(client, "fresh@example.com")
    await client.post(
        "/api/auth/logout",
        json={"refresh_token": register.json()["refresh_token"]},
    )
    relogin = await client.post(
        "/api/auth/login",
        json={"email": "fresh@example.com", "password": "correct-horse-9"},
    )
    assert relogin.status_code == 200
    me = await client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {relogin.json()['token']}"},
    )
    assert me.status_code == 200


async def test_refresh_rotates_and_rejects_reuse(client) -> None:
    register = await _register(client, "rotate@example.com")
    first_refresh = register.json()["refresh_token"]

    rotated = await client.post(
        "/api/auth/refresh", json={"refresh_token": first_refresh}
    )
    assert rotated.status_code == 200
    assert rotated.json()["refresh_token"] != first_refresh

    # Single-use: the presented token was consumed by the rotation.
    reuse = await client.post("/api/auth/refresh", json={"refresh_token": first_refresh})
    assert reuse.status_code == 401


async def test_refresh_reuse_revokes_whole_family_and_access_tokens(client) -> None:
    """M1: replaying a rotated refresh token means the live token was copied
    and used first — the whole token family dies and outstanding access
    tokens are revoked, not just the replayed one."""
    register = await _register(client, "family@example.com")
    stolen_refresh = register.json()["refresh_token"]
    victim_token = register.json()["token"]

    # The thief presents the stolen refresh token first and gets a live session.
    thief = await client.post(
        "/api/auth/refresh", json={"refresh_token": stolen_refresh}
    )
    assert thief.status_code == 200
    thief_token = thief.json()["token"]
    thief_refresh = thief.json()["refresh_token"]

    # The victim's replay of the already-rotated token is the theft signal.
    reuse = await client.post("/api/auth/refresh", json={"refresh_token": stolen_refresh})
    assert reuse.status_code == 401

    # The thief's session is dead: their refresh 401s and their fresh access
    # token no longer authenticates (token_version bumped on detection).
    replay_thief = await client.post(
        "/api/auth/refresh", json={"refresh_token": thief_refresh}
    )
    assert replay_thief.status_code == 401
    me_thief = await client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {thief_token}"}
    )
    assert me_thief.status_code == 401
    me_victim = await client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {victim_token}"}
    )
    assert me_victim.status_code == 401

    # A fresh login starts a new family and keeps working — the blast radius
    # is the compromised family, not the account.
    relogin = await client.post(
        "/api/auth/login",
        json={"email": "family@example.com", "password": "correct-horse-9"},
    )
    assert relogin.status_code == 200
    new_family = await client.post(
        "/api/auth/refresh", json={"refresh_token": relogin.json()["refresh_token"]}
    )
    assert new_family.status_code == 200


async def test_logout_revokes_refresh_token(client) -> None:
    register = await _register(client, "bye@example.com")
    refresh_token = register.json()["refresh_token"]

    logout = await client.post("/api/auth/logout", json={"refresh_token": refresh_token})
    assert logout.status_code == 200

    after = await client.post("/api/auth/refresh", json={"refresh_token": refresh_token})
    assert after.status_code == 401


async def test_garbage_refresh_token_rejected(client) -> None:
    response = await client.post("/api/auth/refresh", json={"refresh_token": "nonsense"})
    assert response.status_code == 401
