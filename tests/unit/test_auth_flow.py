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
