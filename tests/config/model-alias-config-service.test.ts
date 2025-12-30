import { describe, expect, it } from "bun:test";

import { createModelAliasConfigService } from "../../src/config/model-alias-config-service";

describe("ModelAliasConfigService", () => {
  it("returns an empty alias map by default", async () => {
    const service = await createModelAliasConfigService().loadAliases();

    expect(service.getTargetModel("@fast")).toBeUndefined();
    expect(service.hasAlias("@fast")).toBe(false);
    expect(service.listAliases()).toEqual([]);

    const map = service.getAll();
    expect(map.size).toBe(0);
    expect(map.get("@fast")).toBeUndefined();
  });
});
