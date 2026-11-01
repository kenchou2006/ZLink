import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { call, clearAll, createUser } from "./helpers";

describe("User API (recreating Django UserApiTests)", () => {
  beforeEach(async () => {
    await clearAll();
  });

  it("test_staff_cannot_list_users", async () => {
    const staff = await createUser({
      username: "staff",
      isStaff: true,
      isSuperUser: false,
    });
    const res = await call("/api/users/", { token: staff.token });
    expect(res.status).toBe(403);
  });

  it("test_superuser_lists_and_stats", async () => {
    const root = await createUser({ username: "root", isSuperUser: true });
    const listRes = await call("/api/users/", { token: root.token });
    expect(listRes.status).toBe(200);

    const statsRes = await call("/api/users/stats/", { token: root.token });
    expect(statsRes.status).toBe(200);
    const statsData = (await statsRes.json()) as any;
    expect(statsData.superusers).toBe(1);
    expect(statsData.total).toBe(1);
  });

  it("test_create_user_is_staff", async () => {
    const root = await createUser({ username: "root", isSuperUser: true });
    const res = await call("/api/users/", {
      method: "POST",
      token: root.token,
      body: {
        username: "new",
        password: "pass12345",
        confirm_password: "pass12345",
      },
    });

    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.is_staff).toBe(true);

    const row = await env.DB.prepare(
      "SELECT is_staff FROM users WHERE username = ?",
    )
      .bind("new")
      .first<{ is_staff: number }>();
    expect(row?.is_staff).toBe(1);
  });

  it("test_password_mismatch_rejected", async () => {
    const root = await createUser({ username: "root", isSuperUser: true });
    const res = await call("/api/users/", {
      method: "POST",
      token: root.token,
      body: {
        username: "x",
        password: "a",
        confirm_password: "b",
      },
    });
    expect(res.status).toBe(400);
  });

  it("test_cannot_delete_self", async () => {
    const root = await createUser({ username: "root", isSuperUser: true });
    const res = await call(`/api/users/${root.id}/`, {
      method: "DELETE",
      token: root.token,
    });
    expect(res.status).toBe(403);
  });

  it("test_toggle_active", async () => {
    const root = await createUser({ username: "root", isSuperUser: true });
    const target = await createUser({
      username: "staffuser",
      isStaff: true,
      isSuperUser: false,
    });

    // Toggle active -> inactive
    const res1 = await call(`/api/users/${target.id}/toggle-active/`, {
      method: "POST",
      token: root.token,
    });
    expect(res1.status).toBe(200);
    const data1 = (await res1.json()) as any;
    expect(data1.is_active).toBe(false);

    // Toggle inactive -> active
    const res2 = await call(`/api/users/${target.id}/toggle-active/`, {
      method: "POST",
      token: root.token,
    });
    expect(res2.status).toBe(200);
    const data2 = (await res2.json()) as any;
    expect(data2.is_active).toBe(true);
  });

  it("test_cannot_deactivate_self_or_superuser", async () => {
    const root = await createUser({ username: "root", isSuperUser: true });
    // Self
    const selfRes = await call(`/api/users/${root.id}/toggle-active/`, {
      method: "POST",
      token: root.token,
    });
    expect(selfRes.status).toBe(403);

    // Another superuser
    const otherSuper = await createUser({
      username: "other",
      isSuperUser: true,
    });
    const otherRes = await call(`/api/users/${otherSuper.id}/toggle-active/`, {
      method: "POST",
      token: root.token,
    });
    expect(otherRes.status).toBe(403);
  });
});
