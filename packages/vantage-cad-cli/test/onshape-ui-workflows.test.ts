import { describe, expect, it } from "vitest";
import { getOnshapeWorkflowPrompt, listOnshapeWorkflowPrompts } from "../src/onshape-ui/workflows";

describe("Onshape model workflow prompts", () => {
  it("advertises four bounded workflows without internal recipe fields", () => {
    const prompts = listOnshapeWorkflowPrompts();
    expect(prompts.map((prompt) => prompt.name)).toEqual([
      "onshape_dimensioned_part", "onshape_navigate_documents", "onshape_correct_part", "onshape_verify_properties",
    ]);
    for (const prompt of prompts) {
      expect(prompt).not.toHaveProperty("steps");
      expect(prompt.arguments.find((argument) => argument.name === "task")?.required).toBe(true);
    }
    prompts[0]!.arguments[0]!.description = "changed by caller";
    expect(listOnshapeWorkflowPrompts()[0]!.arguments[0]!.description).not.toBe("changed by caller");
  });

  it("enforces prompt identity, required task and bounded text arguments", () => {
    expect(() => getOnshapeWorkflowPrompt("unknown", { task: "Read mass" })).toThrow();
    expect(() => getOnshapeWorkflowPrompt("onshape_verify_properties", {})).toThrow();
    expect(() => getOnshapeWorkflowPrompt("onshape_verify_properties", { task: " " })).toThrow();
    expect(() => getOnshapeWorkflowPrompt("onshape_verify_properties", { task: "Read mass", apiKey: "unexpected" })).toThrow();
    expect(() => getOnshapeWorkflowPrompt("onshape_verify_properties", { task: "x".repeat(8001) })).toThrow();
    expect(() => getOnshapeWorkflowPrompt("onshape_verify_properties", { task: 12 })).toThrow();
    expect(() => getOnshapeWorkflowPrompt("onshape_verify_properties", [])).toThrow();
  });

  it("keeps task details as structured data and asks for missing drawing dimensions", () => {
    const prompt = getOnshapeWorkflowPrompt("onshape_dimensioned_part", { task: "Make a plate\nfrom the drawing", dimensions: "Width 2 in; thickness unknown" });
    expect(prompt.messages[0]?.role).toBe("user");
    const text = prompt.messages[0]!.content.text;
    expect(text).toContain('"task": "Make a plate\\nfrom the drawing"');
    expect(text).toContain("Width 2 in; thickness unknown");
    expect(text).toContain("screenshot has no trustworthy physical scale");
    expect(text).toContain("explicit units in every dimension");
  });

  it("applies one-writer, observed-tool and honest-verification rules to every recipe", () => {
    for (const { name } of listOnshapeWorkflowPrompts()) {
      const text = getOnshapeWorkflowPrompt(name, { task: "Inspect the requested part" }).messages[0]!.content.text;
      expect(text).toContain("exactly one writer");
      expect(text).toContain("onshape_ui_capabilities");
      expect(text).toContain("No Onshape HTTP/API calls");
      expect(text).toContain("Do not claim independent review unless another reviewer actually inspected");
      expect(text).toContain("Do not promise a sub-four-minute result");
    }
  });

  it("requires physical-property provenance and distinguishes principal values from tensors", () => {
    const text = getOnshapeWorkflowPrompt("onshape_verify_properties", { task: "Check inertia", material: "Aluminum 6061" }).messages[0]!.content.text;
    expect(text).toContain("material and density assignment");
    expect(text).toContain("Principal moments are not interchangeable with a tensor");
    expect(text).toContain("kg*m^2");
    expect(text).toContain("selected-part context");
  });
});
