import { Command } from "cmdk";
import { GlassSurface } from "./glass-surface.js";

export interface PaletteAction {
  id: string;
  name: string;
  shortcut?: string;
  group: string;
  perform: () => void;
}

export function groupBy<T>(items: T[], key: (t: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const k = key(item);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: PaletteAction[];
}

/** A5 §2.3: kbar 패턴({id,name,shortcut,perform}) 액션을 group으로 묶어 GlassSurface(slot="palette")에 렌더링. */
export function CommandPalette({ open, onOpenChange, actions }: CommandPaletteProps) {
  const groups = groupBy(actions, (a) => a.group);
  return (
    <Command.Dialog open={open} onOpenChange={onOpenChange} label="omnis command palette">
      <GlassSurface slot="palette">
        <Command.Input placeholder="검색 또는 명령…" />
        <Command.List>
          <Command.Empty>결과가 없어요</Command.Empty>
          {Object.entries(groups).map(([group, items]) => (
            <Command.Group key={group} heading={group}>
              {items.map((action) => (
                <Command.Item
                  key={action.id}
                  onSelect={() => {
                    action.perform();
                    onOpenChange(false);
                  }}
                >
                  <span>{action.name}</span>
                  {action.shortcut && <kbd>{action.shortcut}</kbd>}
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>
      </GlassSurface>
    </Command.Dialog>
  );
}
