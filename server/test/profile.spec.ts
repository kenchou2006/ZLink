import { beforeEach, describe, expect, it } from "vitest";
import { call, clearAll, createUser } from "./helpers";

describe("Profile API (recreating Django ProfileTests)", () => {
  beforeEach(async () => {
    await clearAll();
  });

  it("test_get_profile", async () => {
    const user = await createUser({ username: "me", password: "pass12345" });
    const res = await call("/api/profile/", { token: user.token });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.username).toBe("me");
  });

  it("test_change_password_requires_correct_current", async () => {
    const user = await createUser({ username: "me", password: "pass12345" });
    const res = await call("/api/profile/", {
      method: "PATCH",
      token: user.token,
      body: {
        current_password: "wrong",
        new_password: "newpass123",
        confirm_password: "newpass123",
      },
    });
    expect(res.status).toBe(400);
  });

  it("test_update_avatar", async () => {
    const user = await createUser({ username: "me", password: "pass12345" });
    const res = await call("/api/profile/", {
      method: "PATCH",
      token: user.token,
      body: { avatar_url: "https://img.example.com/a.png" },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.user.avatar_url).toBe("https://img.example.com/a.png");
  });

  it("test_cannot_disable_password_login_without_passkey", async () => {
    const user = await createUser({ username: "me", password: "pass12345" });
    const res = await call("/api/profile/", {
      method: "PATCH",
      token: user.token,
      body: { password_login_disabled: true },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.password_login_disabled).toBeDefined();
  });
});
