/** Every body in the system, moons indented under their parents. */
import { useEffect, useRef } from "preact/hooks";
import { bodyPosition, dist, type SystemDetail, type Vec2 } from "../../../sim";
import { BODY_COLOR } from "../../palette";
import { fmtAU, shortKind } from "./util";

export interface BodyListProps {
  detail: SystemDetail;
  time: number;
  shipPos: Vec2;
  scanned: string[];
  orbitingId: string | null;
  selectedId: string | null;
  hoverId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}

export function BodyList({ detail, time, shipPos, scanned, orbitingId, selectedId, hoverId, onSelect, onHover }: BodyListProps) {
  const box = useRef<HTMLDivElement>(null);

  // Keep the selected row visible when the selection came from the map.
  useEffect(() => {
    const row = box.current?.querySelector<HTMLElement>("tr.selected");
    if (!row || !box.current) return;
    const area = box.current;
    if (row.offsetTop < area.scrollTop + 24) area.scrollTop = Math.max(0, row.offsetTop - 24);
    else if (row.offsetTop + row.offsetHeight > area.scrollTop + area.clientHeight) {
      area.scrollTop = row.offsetTop + row.offsetHeight - area.clientHeight;
    }
  }, [selectedId]);

  return (
    <div class="sys-list" ref={box} onMouseLeave={() => onHover(null)}>
      <table class="data sys-table">
        <thead>
          <tr>
            <th>Body</th>
            <th>Kind</th>
            <th class="num">AU</th>
          </tr>
        </thead>
        <tbody>
          {detail.bodies.map((b) => {
            const here = b.id === orbitingId;
            const d = dist(shipPos, bodyPosition(detail, b, time));
            const cls = `${b.id === selectedId ? "selected" : ""} ${b.id === hoverId ? "hover" : ""}`;
            return (
              <tr key={b.id} class={cls} onClick={() => onSelect(b.id)} onMouseEnter={() => onHover(b.id)}>
                <td class={b.parentId ? "sys-moon" : ""}>
                  <span class="sys-dot" style={{ background: BODY_COLOR[b.kind] }} />
                  {b.name}
                  {scanned.includes(b.id) && <span class="sys-scanned" title="Scanned" />}
                </td>
                <td class="muted">{shortKind(b.kind)}</td>
                <td class={`num ${here ? "ship" : ""}`}>{here ? "orbit" : fmtAU(d)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
