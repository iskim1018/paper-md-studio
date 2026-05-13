import { Crepe } from "@milkdown/crepe";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { useEffect, useRef } from "react";

import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { usePanelSearch } from "../../hooks/use-panel-search";
import { SearchBar } from "./search-bar";

interface MilkdownEditorProps {
  readonly initialValue: string;
  readonly onChange: (markdown: string) => void;
  readonly readOnly?: boolean;
}

/**
 * Milkdown Crepe 기반 WYSIWYG Markdown 에디터.
 *
 * - initialValue는 mount 시 한 번만 반영된다. 외부에서 문서가 교체되면
 *   key를 통해 컴포넌트를 재마운트해야 한다.
 * - onChange는 디바운스되지 않은 원시 이벤트. 스토어 쪽에서 dirty 비교가
 *   저렴하므로 추가 디바운스는 생략.
 */
function MilkdownEditorInner({
  initialValue,
  onChange,
  readOnly = false,
}: MilkdownEditorProps) {
  // onChange는 클로저 캡처 시점을 고정하지 않도록 ref로 최신값 참조
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEditor((root) => {
    const crepe = new Crepe({
      root,
      defaultValue: initialValue,
    });

    crepe.setReadonly(readOnly);

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        onChangeRef.current(markdown);
      });
    });

    return crepe;
  });

  return <Milkdown />;
}

export function MilkdownEditor(props: MilkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // initialValue가 바뀌면 컴포넌트가 재마운트되므로 그 자체가 resetKey 역할
  const { visible, focusToken, search, close } = usePanelSearch({
    containerRef,
    contentRef,
    resetKey: props.initialValue,
  });

  return (
    <MilkdownProvider>
      <div
        ref={containerRef}
        className="relative h-full"
        data-testid="milkdown-editor"
        tabIndex={-1}
      >
        <SearchBar
          visible={visible}
          focusToken={focusToken}
          query={search.query}
          matches={search.matches}
          activeIndex={search.activeIndex}
          setQuery={search.setQuery}
          next={search.next}
          prev={search.prev}
          clear={search.clear}
          onClose={close}
        />
        <div
          ref={contentRef}
          className="milkdown-container h-full overflow-y-auto"
        >
          <MilkdownEditorInner {...props} />
        </div>
      </div>
    </MilkdownProvider>
  );
}
