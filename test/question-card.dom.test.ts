import { describe, it, expect } from "vitest";
import { bootWebview, dispatch, click } from "./webview-harness";

const SINGLE = {
  id: 3,
  questions: [{
    question: "Pick one?",
    options: [
      { label: "Option A", description: "first" },
      { label: "Option B", description: "second" },
    ],
    multiSelect: false,
  }],
};

describe("question card (real webview/app.js in a DOM)", () => {
  it("renders the question text and its options", () => {
    const { window, doc } = bootWebview();
    dispatch(window, { type: "questionRequest", req: SINGLE });
    const card = doc.querySelector(".card.question");
    expect(card).not.toBeNull();
    expect(card!.querySelector(".question-text")!.textContent).toBe("Pick one?");
    const labels = [...card!.querySelectorAll(".question-option .question-option-label")].map((b) => b.textContent);
    expect(labels).toEqual(["Option A", "Option B"]);
    expect(card!.querySelector(".question-option-desc")!.textContent).toBe("first");
  });
  it("single-select with one question resolves on a single click and shows the chosen answer", () => {
    const { window, posted, doc } = bootWebview();
    dispatch(window, { type: "questionRequest", req: SINGLE });
    const optB = [...doc.querySelectorAll(".card.question .question-option")]
      .find((b) => b.textContent!.includes("Option B")) as HTMLButtonElement;
    click(window, optB);
    expect(posted).toEqual([{
      type: "questionAnswer",
      requestId: 3,
      answers: { "Pick one?": "Option B" },
      annotations: {},
    }]);
    const card = doc.querySelector(".card.question")!;
    expect(card.classList.contains("resolved")).toBe(true);
    expect(card.querySelector(".card-title")!.textContent).toBe("You answered");
    expect(card.querySelector(".question-text")!.textContent).toBe("Pick one?");
    expect(card.querySelector(".question-answer")!.textContent).toBe("✓ Option B");
    expect(card.querySelectorAll(".question-option")).toHaveLength(0);
    expect(card.querySelector(".question-skip")).toBeNull();
  });
  it("multi-select toggles options and gates Submit on having a selection", () => {
    const { window, posted, doc } = bootWebview();
    dispatch(window, {
      type: "questionRequest",
      req: { id: 4, questions: [{ question: "Which?", options: [{ label: "A" }, { label: "B" }, { label: "C" }], multiSelect: true }] },
    });
    const card = doc.querySelector(".card.question")!;
    const submit = [...card.querySelectorAll(".card-actions button")]
      .find((b) => b.textContent === "Submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    const opts = [...card.querySelectorAll(".question-option")] as HTMLButtonElement[];
    click(window, opts[0]);
    click(window, opts[2]);
    expect(opts[0].classList.contains("selected")).toBe(true);
    expect(submit.disabled).toBe(false);
    click(window, opts[0]);
    expect(opts[0].classList.contains("selected")).toBe(false);
    click(window, submit);
    expect(posted).toEqual([{
      type: "questionAnswer",
      requestId: 4,
      answers: { "Which?": "C" },
      annotations: {},
    }]);
  });
  it("multiple questions keep Submit disabled until all are answered", () => {
    const { window, posted, doc } = bootWebview();
    dispatch(window, {
      type: "questionRequest",
      req: {
        id: 5,
        questions: [
          { question: "Q1", options: [{ label: "1a" }, { label: "1b" }] },
          { question: "Q2", options: [{ label: "2a" }, { label: "2b" }] },
        ],
      },
    });
    const card = doc.querySelector(".card.question")!;
    const blocks = [...card.querySelectorAll(".question-block")];
    const submit = [...card.querySelectorAll(".card-actions button")]
      .find((b) => b.textContent === "Submit") as HTMLButtonElement;
    click(window, blocks[0].querySelector(".question-option") as HTMLButtonElement);
    expect(submit.disabled).toBe(true);
    click(window, blocks[1].querySelectorAll(".question-option")[1] as HTMLButtonElement);
    expect(submit.disabled).toBe(false);
    click(window, submit);
    expect(posted[0]).toEqual({
      type: "questionAnswer",
      requestId: 5,
      answers: { Q1: "1a", Q2: "2b" },
      annotations: {},
    });
  });
  it("'Skip' posts questionCancel and collapses to a skipped state", () => {
    const { window, posted, doc } = bootWebview();
    dispatch(window, { type: "questionRequest", req: SINGLE });
    const skip = doc.querySelector(".card.question .question-skip") as HTMLButtonElement;
    click(window, skip);
    expect(posted).toEqual([{ type: "questionCancel", requestId: 3 }]);
    const card = doc.querySelector(".card.question")!;
    expect(card.classList.contains("resolved")).toBe(true);
    expect(card.querySelector(".card-title")!.textContent).toBe("Skipped");
    expect(card.querySelector(".question-answer")!.textContent).toBe("(skipped)");
  });
});

describe("question card — resume restore (replayed tool_call)", () => {
  const replayQuestion = (window: Window, posted?: unknown[]) => {
    dispatch(window, { type: "historyReplay", active: true });
    dispatch(window, {
      type: "toolCall",
      call: {
        toolCallId: "c1",
        title: "ask_user_question",
        rawInput: { questions: [{ question: "Pick one?", options: [{ label: "Option A" }, { label: "Option B" }] }] },
      },
    });
    dispatch(window, {
      type: "toolCallUpdate",
      call: {
        toolCallId: "c1",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: 'User has answered your questions: "Pick one?"="Option A". You can now continue.' } }],
      },
    });
    dispatch(window, { type: "historyReplay", active: false });
  };
  it("rebuilds a read-only answered card with the question and chosen answer", () => {
    const { window, doc } = bootWebview();
    replayQuestion(window);
    const card = doc.querySelector(".card.question.resolved")!;
    expect(card).not.toBeNull();
    expect(card.querySelector(".card-title")!.textContent).toBe("You answered");
    expect(card.querySelector(".question-text")!.textContent).toBe("Pick one?");
    expect(card.querySelector(".question-answer")!.textContent).toBe("✓ Option A");
  });
  it("does not render the generic tool chip for the replayed question", () => {
    const { window, doc } = bootWebview();
    replayQuestion(window);
    expect(doc.querySelectorAll(".card.question")).toHaveLength(1);
    expect(doc.body.textContent).not.toMatch(/Running ask_user_question/);
  });
  it("restores a cursor/composer-agent (AskQuestion) session, mapping option ids to labels", () => {
    const { window, doc } = bootWebview();
    dispatch(window, { type: "historyReplay", active: true });
    dispatch(window, {
      type: "toolCall",
      call: {
        toolCallId: "c2",
        title: "AskQuestion",
        rawInput: {
          title: "Quick test",
          questions: [{
            id: "detective",
            prompt: "Which fictional detective would you trust to debug at 3 a.m.?",
            options: [{ id: "poirot", label: "Hercule Poirot" }, { id: "holmes", label: "Sherlock Holmes" }],
          }],
        },
      },
    });
    dispatch(window, {
      type: "toolCallUpdate",
      call: {
        toolCallId: "c2",
        status: "Completed",
        content: [{ type: "content", content: { type: "text", text: "User questions responses:\nQuestion detective: Selected option(s) poirot" } }],
      },
    });
    dispatch(window, { type: "historyReplay", active: false });
    const card = doc.querySelector(".card.question.resolved")!;
    expect(card.querySelector(".question-text")!.textContent).toBe("Which fictional detective would you trust to debug at 3 a.m.?");
    expect(card.querySelector(".question-answer")!.textContent).toBe("✓ Hercule Poirot");
  });
  it("restores a replayed call whose title was relabelled to 'Ask: <question>' (rawInput present)", () => {
    const { window, doc } = bootWebview();
    dispatch(window, { type: "historyReplay", active: true });
    dispatch(window, {
      type: "toolCall",
      call: {
        toolCallId: "c3",
        title: "Ask: If you had to eat only one food forever, which?",
        rawInput: { questions: [{ question: "If you had to eat only one food forever, which?", options: [{ label: "Pizza" }, { label: "Sushi" }] }] },
      },
    });
    dispatch(window, {
      type: "toolCallUpdate",
      call: { toolCallId: "c3", title: "Ask: If you had to eat only one food forever, which?" },
    });
    dispatch(window, {
      type: "toolCallUpdate",
      call: {
        toolCallId: "c3",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: 'User has answered your questions: "If you had to eat only one food forever, which?"="Pizza". You can now continue.' } }],
      },
    });
    dispatch(window, { type: "historyReplay", active: false });
    expect(doc.querySelectorAll(".tool-group")).toHaveLength(0);
    const card = doc.querySelector(".card.question.resolved")!;
    expect(card.querySelector(".question-text")!.textContent).toBe("If you had to eat only one food forever, which?");
    expect(card.querySelector(".question-answer")!.textContent).toBe("✓ Pizza");
  });
  it("restores from the 'Ask: <question>' title alone when rawInput.questions didn't survive", () => {
    const { window, doc } = bootWebview();
    dispatch(window, { type: "historyReplay", active: true });
    dispatch(window, {
      type: "toolCall",
      call: { toolCallId: "c4", title: "Ask: Pick a number?" },
    });
    dispatch(window, {
      type: "toolCallUpdate",
      call: {
        toolCallId: "c4",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: 'User has answered your questions: "Pick a number?"="Seven". You can now continue.' } }],
      },
    });
    dispatch(window, { type: "historyReplay", active: false });
    expect(doc.querySelectorAll(".tool-group")).toHaveLength(0);
    const card = doc.querySelector(".card.question.resolved")!;
    expect(card.querySelector(".question-text")!.textContent).toBe("Pick a number?");
    expect(card.querySelector(".question-answer")!.textContent).toBe("✓ Seven");
  });
});
