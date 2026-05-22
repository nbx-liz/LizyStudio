import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBackgroundNotification } from "./useBackgroundNotification";

// Mock Notification API
const mockNotification = vi.fn();

describe("useBackgroundNotification", () => {
  let originalNotification: typeof Notification;
  let hasFocusSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockNotification.mockClear();
    originalNotification = globalThis.Notification;
    // @ts-expect-error - mock Notification constructor
    globalThis.Notification = mockNotification;
    // @ts-expect-error - mock static property
    globalThis.Notification.permission = "granted";
    globalThis.Notification.requestPermission = vi.fn();

    hasFocusSpy = vi.spyOn(document, "hasFocus");
    hasFocusSpy.mockReturnValue(false); // Default: tab not focused
  });

  afterEach(() => {
    globalThis.Notification = originalNotification;
    vi.restoreAllMocks();
  });

  it("returns a function", () => {
    const { result } = renderHook(() => useBackgroundNotification());
    expect(typeof result.current).toBe("function");
  });

  it("creates notification when tab is not focused and permission granted", () => {
    const { result } = renderHook(() => useBackgroundNotification());
    result.current("Job Complete", "Your model is ready");

    expect(mockNotification).toHaveBeenCalledWith("Job Complete", {
      body: "Your model is ready",
      icon: "/favicon.ico",
    });
  });

  it("does not create notification when tab is focused", () => {
    hasFocusSpy.mockReturnValue(true);
    const { result } = renderHook(() => useBackgroundNotification());
    result.current("Job Complete");

    expect(mockNotification).not.toHaveBeenCalled();
  });

  it("does not create notification when Notification API is undefined", () => {
    // @ts-expect-error - simulate missing API
    delete globalThis.Notification;
    const { result } = renderHook(() => useBackgroundNotification());
    // Should not throw
    result.current("Job Complete");
    expect(mockNotification).not.toHaveBeenCalled();
  });

  it("requests permission when not yet decided", async () => {
    // @ts-expect-error - mock permission state
    globalThis.Notification.permission = "default";
    globalThis.Notification.requestPermission = vi
      .fn()
      .mockResolvedValue("granted");

    const { result } = renderHook(() => useBackgroundNotification());
    result.current("Job Complete", "Ready");

    expect(Notification.requestPermission).toHaveBeenCalledTimes(1);
    // After permission is granted, notification should be created
    await vi.waitFor(() => {
      expect(mockNotification).toHaveBeenCalledWith("Job Complete", {
        body: "Ready",
        icon: "/favicon.ico",
      });
    });
  });

  it("does not create notification when permission denied", () => {
    // @ts-expect-error - mock permission state
    globalThis.Notification.permission = "denied";
    const { result } = renderHook(() => useBackgroundNotification());
    result.current("Job Complete");

    expect(mockNotification).not.toHaveBeenCalled();
  });

  it("does not request permission when already denied", () => {
    // @ts-expect-error - mock permission state
    globalThis.Notification.permission = "denied";
    const { result } = renderHook(() => useBackgroundNotification());
    result.current("Job Complete");

    expect(Notification.requestPermission).not.toHaveBeenCalled();
  });

  it("handles title-only notification (no body)", () => {
    const { result } = renderHook(() => useBackgroundNotification());
    result.current("Done");

    expect(mockNotification).toHaveBeenCalledWith("Done", {
      body: undefined,
      icon: "/favicon.ico",
    });
  });

  it("does not create notification when permission request is denied", async () => {
    // @ts-expect-error - mock permission state
    globalThis.Notification.permission = "default";
    globalThis.Notification.requestPermission = vi
      .fn()
      .mockResolvedValue("denied");

    const { result } = renderHook(() => useBackgroundNotification());
    result.current("Job Complete");

    // Wait for async requestPermission to complete
    await vi.waitFor(() => {
      expect(Notification.requestPermission).toHaveBeenCalledTimes(1);
    });
    // Notification should NOT have been created
    expect(mockNotification).not.toHaveBeenCalled();
  });
});
