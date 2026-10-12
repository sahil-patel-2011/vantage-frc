import { describe, expect, it } from "vitest";
import { looksLikeJava } from "./looks-like-java";

describe("looksLikeJava (A5-26)", () => {
  it("recognises robot code", () => {
    expect(looksLikeJava("public class Intake extends SubsystemBase {\n  private final TalonFX motor = new TalonFX(1);\n}")).toBe(true);
    expect(looksLikeJava("import edu.wpi.first.wpilibj2.command.Command;")).toBe(true);
  });

  it("does not call prose or an empty box Java", () => {
    expect(looksLikeJava("hello this is not java")).toBe(false);
    expect(looksLikeJava("   ")).toBe(false);
  });
});
