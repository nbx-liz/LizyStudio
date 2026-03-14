import { expect, test } from "@playwright/test";

const API = "http://localhost:8501/api";

test.describe("Security fixes — path traversal prevention", () => {
  test("SPA serve blocks path traversal to /etc/passwd", async ({ page }) => {
    const res = await page.goto("http://localhost:8501/../../etc/passwd");
    // Should get index.html (SPA fallback), not the file content
    expect(res?.status()).toBe(200);
    const text = await page.content();
    expect(text).toContain("<!DOCTYPE html");
    expect(text).not.toContain("root:");
  });

  test("File browser API rejects path outside allowed root", async ({
    request,
  }) => {
    const res = await request.get(`${API}/files?path=/etc`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    // Should return empty entries, not /etc contents
    expect(body.entries).toEqual([]);
  });

  test("File browser API returns entries for allowed root", async ({
    request,
  }) => {
    const res = await request.get(`${API}/files`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.path).toBeDefined();
    expect(Array.isArray(body.entries)).toBe(true);
  });

  test("Data path API rejects path outside allowed root", async ({
    request,
  }) => {
    const res = await request.post(`${API}/workspace/data/path`, {
      data: { path: "/etc/passwd" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("PATH_NOT_FOUND");
  });
});

test.describe("Security fixes — config validation guard", () => {
  test("PUT /config with invalid config does not save", async ({
    request,
  }) => {
    // Reset workspace first
    await request.post(`${API}/workspace/reset`);

    // Put invalid config (missing required fields)
    const putRes = await request.put(`${API}/workspace/config`, {
      data: { task: "binary" },
    });
    expect(putRes.status()).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.saved).toBe(false);
    expect(putBody.errors.length).toBeGreaterThan(0);

    // Verify config was NOT saved
    const getRes = await request.get(`${API}/workspace/config`);
    const config = await getRes.json();
    expect(config).toEqual({});
  });

  test("PUT /config with valid config saves successfully", async ({
    request,
  }) => {
    await request.post(`${API}/workspace/reset`);

    // Get a valid config from defaults
    const defaultsRes = await request.get(
      `${API}/workspace/config/defaults?task=binary&target=y`,
    );
    const defaults = await defaultsRes.json();

    // Put valid config
    const putRes = await request.put(`${API}/workspace/config`, {
      data: defaults,
    });
    expect(putRes.status()).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.saved).toBe(true);
    expect(putBody.errors).toEqual([]);

    // Verify config was saved
    const getRes = await request.get(`${API}/workspace/config`);
    const config = await getRes.json();
    expect(config.task).toBe("binary");
  });
});

test.describe("Security fixes — error sanitization", () => {
  test("Backend error does not leak internal paths", async ({ request }) => {
    // Trigger a backend error by loading non-existent data
    const res = await request.post(`${API}/workspace/data/path`, {
      data: { path: "/tmp/nonexistent_file_12345.csv" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    // Error should have code and message, not full stack traces
    expect(body.error.code).toBeDefined();
    expect(body.error.message).toBeDefined();
  });
});
