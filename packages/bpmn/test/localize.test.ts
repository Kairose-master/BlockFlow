import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkSoundness, checkStructure } from "@blockflow/validator";
import { lintBpmn, localizeExampleBpmn, parseBpmn } from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(here, "..", "examples");
const files = readdirSync(examplesDir).filter((file) => file.endsWith(".bpmn")).sort();
const read = (file: string) => readFileSync(join(examplesDir, file), "utf8");
const humanFacingText = (xml: string) =>
  [...xml.matchAll(/\s(?:name|label)="([^"]+)"/g)].map((match) => match[1]).join(" ");

describe("example BPMN localization", () => {
  for (const file of files) {
    it(`${file}: English labels remain valid and Korean can be restored`, async () => {
      const korean = read(file);
      const english = localizeExampleBpmn(korean, "en");

      expect(english).not.toBe(korean);
      expect(humanFacingText(english)).not.toMatch(/[가-힣]/);
      expect(await lintBpmn(english)).toEqual([]);

      const { ir, warnings } = await parseBpmn(english);
      expect(warnings).toEqual([]);
      expect(checkStructure(ir)).toEqual([]);
      expect(checkSoundness(ir).problems).toEqual([]);
      expect(localizeExampleBpmn(english, "ko")).toBe(korean);
    });
  }

  it("does not rewrite a user's custom label", () => {
    const custom = read("expense-approval.bpmn").replace('name="경비 신청"', 'name="내 경비 정책"');
    expect(localizeExampleBpmn(custom, "en")).toContain('name="내 경비 정책"');
  });
});
