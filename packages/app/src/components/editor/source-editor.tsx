import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";

interface SourceEditorProps {
  readonly initialValue: string;
  readonly onChange: (markdown: string) => void;
  readonly readOnly?: boolean;
}

/**
 * CodeMirror 6 기반 Markdown 소스 편집기.
 *
 * - initialValue는 mount 시 한 번만 반영된다. 외부에서 문서가 교체되면
 *   부모가 key prop으로 재마운트해야 한다 (MilkdownEditor와 동일 규약).
 * - 내장 history 확장으로 Cmd/Ctrl+Z undo 지원.
 */
export function SourceEditor({
  initialValue,
  onChange,
  readOnly = false,
}: SourceEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // initialValue/readOnly는 mount 시 한 번만 반영. 변경은 key prop 재마운트로.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-only
  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: initialValue,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        oneDark,
        EditorView.lineWrapping,
        EditorState.readOnly.of(readOnly),
        updateListener,
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    return () => {
      view.destroy();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="source-editor h-full overflow-hidden"
      data-testid="source-editor"
    />
  );
}
