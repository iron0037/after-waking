/** Every body in the system, moons indented under their parents. */
import { useEffect, useRef } from "preact/hooks";
import { bodyPosition, dist, type BodyProgress, type Contract, type SystemDetail, type Vec2 } from "../../../sim";
import { BODY_COLOR } from "../../palette";
import { fmtAU, progressLabel, shortKind } from "./util";

export interface BodyListProps {
  detail: SystemDetail;
  time: number;
  shipPos: Vec2;
  scanned: string[];
  orbitingId: string | null;
  selectedId: string | null;
  hoverId: string | null;
  progress: Map<string, BodyProgress>;
  targets: Map<string, Contract[]>;
  /** Scanned bodies the current ship can land on and mine. */
  landable: Set<string>;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}

export function BodyList({ detail, time, shipPos, scanned, orbitingId, selectedId, hoverId, progress, targets, landable, onSelect, onHover }: BodyListProps) {
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
            <th class="num" title="Regions landed on / surface explored by rover sensors">Explored</th>
            <th class="num">AU</th>
          </tr>
        </thead>
        <tbody>
          {detail.bodies.map((b) => {
            const here = b.id === orbitingId;
            const d = dist(shipPos, bodyPosition(detail, b, time));
            const prog = progress.get(b.id);
            const jobs = targets.get(b.id) ?? [];
            const cls = `${b.id === selectedId ? "selected" : ""} ${b.id === hoverId ? "hover" : ""}`;
            return (
              <tr key={b.id} class={cls} onClick={() => onSelect(b.id)} onMouseEnter={() => onHover(b.id)}>
                <td class={b.parentId ? "sys-moon" : ""}>
                  <span class="sys-dot" style={{ background: BODY_COLOR[b.kind] }} />
                  {b.name}
                  {b.nickname && <span class="muted"> · {b.nickname}</span>}
                  {scanned.includes(b.id) && <span class="sys-scanned" title="Scanned" />}
                  {scanned.includes(b.id) && landable.has(b.id) && (
                    <span class="good" title="Your ship can land here and mine">
                      {" "}
                      ▼
                    </span>
                  )}
                  {b.easy && (
                    <span class="sys-calm" title="A calm home world: mild conditions and forgiving terrain">
                      calm
                    </span>
                  )}
                  {jobs.length > 0 && (
                    <span class="sys-job" title={`Contract: ${jobs.map((c) => c.title).join("; ")}`}>
                      ◆
                    </span>
                  )}
                </td>
                <td class="muted">{shortKind(b.kind)}</td>
                <td class={`num sys-prog ${prog && prog.regionsVisited > 0 ? "" : "muted"}`}>{prog ? progressLabel(prog) : "—"}</td>
                <td class={`num ${here ? "ship" : ""}`}>{here ? "orbit" : fmtAU(d)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
