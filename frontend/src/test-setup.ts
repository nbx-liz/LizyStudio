import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./test/mocks/server";

// Issue #575: ``"error"`` (was ``"warn"``) makes every unmocked request fail
// the test immediately, instead of letting it leak to happy-dom's default
// ``http://localhost:3000`` where it caused stochastic libuv worker crashes
// during teardown. Individual tests can still override globally-registered
// handlers via ``server.use(...)``.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());
