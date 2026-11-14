import { generateArchitectDraft } from "./architect-constraints.js";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      phase: "Building places, people, and their connections…",
    });
    const generated = generateArchitectDraft(
      data.prompt,
      data.universe,
      data.profile,
      data.constraints,
    );
    self.postMessage({ generated });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
