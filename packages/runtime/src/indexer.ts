/**
 * indexer.ts — 온체인 이벤트 → 인스턴스 상태·타임라인 (가이드 8.3).
 *
 * MarkingChanged 하나만 보면 현재 상태를 복원할 수 있고(6.4), TaskCompleted 가 타임라인이다.
 * 어댑터의 watch() 로 구독하고, 재시작 시 fromBlock 부터 재생한다. 저장소는 메모리 + 선택적 JSON 스냅샷
 * (Phase 3 MVP; Postgres 는 후속). 인덱서가 죽어도 UI 는 어댑터 read() 로 폴백한다 (3.3 신뢰 경계).
 */
import type { IR } from "@blockflow/ir";
import type { Abi } from "viem";
import type { Address, DecodedEvent, ProcessAdapter } from "./adapter";

export interface InstanceState {
  id: bigint;
  marking: bigint;
  ended: boolean;
  /** InstanceEnded(completed=true) → "completed", false → 비정상 종료 */
  outcome?: "completed" | "rejected";
  creator?: Address;
  roles: Record<string, Address>; // roleKey → 주소
  createdBlock: bigint;
}

export interface TimelineEntry {
  block: bigint;
  seq: number;
  instance: bigint;
  kind: "created" | "roleBound" | "taskCompleted" | "markingChanged" | "ended" | "paused";
  /** 사람이 읽는 문장 */
  text: string;
  actor?: Address;
  taskId?: number;
  marking?: bigint;
}

export interface ProcessRecord {
  address: Address;
  ir: IR;
  abi: Abi;
  owner: Address;
  deployedBlock: bigint;
  paused: boolean;
  instances: Map<bigint, InstanceState>;
  timeline: TimelineEntry[];
  /** 마지막으로 반영한 블록 (재생 시작점) */
  lastBlock: bigint;
}

export interface IndexerSnapshot {
  processes: {
    address: Address;
    ir: IR;
    abi: Abi;
    owner: Address;
    deployedBlock: string;
    paused: boolean;
    lastBlock: string;
    instances: (Omit<InstanceState, "id" | "marking" | "createdBlock"> & { id: string; marking: string; createdBlock: string })[];
    timeline: (Omit<TimelineEntry, "block" | "instance" | "marking"> & { block: string; instance: string; marking?: string })[];
  }[];
}

export class Indexer {
  readonly processes = new Map<Address, ProcessRecord>();
  private stops = new Map<Address, () => void>();
  private listeners = new Set<(address: Address) => void>();

  constructor(private readonly adapter: ProcessAdapter) {}

  /** 프로세스를 등록하고 구독을 시작한다. 이미 있던 기록이 있으면 lastBlock+1 부터 재생. */
  track(address: Address, ir: IR, abi: Abi, owner: Address, deployedBlock = 0n): ProcessRecord {
    let rec = this.processes.get(address);
    if (!rec) {
      rec = { address, ir, abi, owner, deployedBlock, paused: false, instances: new Map(), timeline: [], lastBlock: deployedBlock - 1n };
      this.processes.set(address, rec);
    }
    this.stops.get(address)?.();
    const from = rec.lastBlock + 1n;
    const stop = this.adapter.watch(address, abi, (e) => this.apply(rec!, e, e.blockNumber), from < 0n ? 0n : from);
    this.stops.set(address, stop);
    return rec;
  }

  stop(): void {
    for (const s of this.stops.values()) s();
    this.stops.clear();
  }

  onChange(cb: (address: Address) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private apply(rec: ProcessRecord, e: DecodedEvent, block: bigint): void {
    const a = e.args as Record<string, unknown>;
    const id = a.id !== undefined ? BigInt(a.id as bigint) : undefined;
    const seq = rec.timeline.length;
    const inst = id !== undefined ? rec.instances.get(id) : undefined;
    const push = (entry: Omit<TimelineEntry, "block" | "seq">) => rec.timeline.push({ block, seq, ...entry });
    const ir = rec.ir;

    switch (e.name) {
      case "InstanceCreated": {
        if (id === undefined) break;
        const existing = rec.instances.get(id) ?? { id, marking: 0n, ended: false, roles: {}, createdBlock: block };
        existing.creator = a.creator as Address;
        rec.instances.set(id, existing);
        push({ instance: id, kind: "created", text: `#${id} 새 건 시작`, actor: a.creator as Address });
        break;
      }
      case "RoleBound": {
        if (id === undefined) break;
        const existing = rec.instances.get(id) ?? { id, marking: 0n, ended: false, roles: {}, createdBlock: block };
        const role = ir.roles.find((r) => roleHash(r.key) === String(a.role).toLowerCase());
        if (role) existing.roles[role.key] = a.account as Address;
        rec.instances.set(id, existing);
        push({ instance: id, kind: "roleBound", text: `#${id} [${role?.label ?? String(a.role)}] 담당자 지정`, actor: a.account as Address });
        break;
      }
      case "TaskCompleted": {
        if (id === undefined) break;
        const taskId = Number(a.taskId);
        const task = ir.nodes.find((n) => n.kind === "userTask" && n.taskId === taskId);
        push({ instance: id, kind: "taskCompleted", text: `#${id} [${task?.kind === "userTask" ? task.label : `태스크 ${taskId}`}] 완료`, actor: a.actor as Address, taskId });
        break;
      }
      case "MarkingChanged": {
        if (id === undefined || !inst) break;
        inst.marking = BigInt(a.marking as bigint);
        push({ instance: id, kind: "markingChanged", text: `#${id} 상태 갱신`, marking: inst.marking });
        break;
      }
      case "InstanceEnded": {
        if (id === undefined || !inst) break;
        inst.ended = true;
        inst.outcome = a.completed ? "completed" : "rejected";
        push({ instance: id, kind: "ended", text: `#${id} ${a.completed ? "정상 완료" : "중단(반려)"}` });
        break;
      }
      case "Paused": {
        rec.paused = Boolean(a.paused);
        push({ instance: 0n, kind: "paused", text: rec.paused ? "프로세스 일시정지" : "프로세스 재개" });
        break;
      }
      default:
        break;
    }
    if (block > rec.lastBlock) rec.lastBlock = block;
    for (const l of this.listeners) l(rec.address);
  }

  /** 인스턴스별 현재 활성 태스크 (marking 으로 계산, 컨트랙트의 enabledTasks 와 같다). */
  enabledTasks(rec: ProcessRecord, inst: InstanceState): { taskId: number; id: string; name: string; label: string; role: string }[] {
    if (inst.ended) return [];
    const bit = (fid: string) => 1n << BigInt(rec.ir.flows.find((f) => f.id === fid)!.bit);
    return rec.ir.nodes
      .filter((n) => n.kind === "userTask")
      .filter((n) => n.kind === "userTask" && n.in.some((fid) => (inst.marking & bit(fid)) !== 0n))
      .map((n) => (n.kind === "userTask" ? { taskId: n.taskId, id: n.id, name: n.name, label: n.label, role: n.role } : null!))
      .filter(Boolean);
  }

  /** 어댑터 read() 로 인덱서 상태를 검증/보정한다 (인덱서 다운 시 폴백과 같은 경로). */
  async refresh(address: Address): Promise<void> {
    const rec = this.processes.get(address);
    if (!rec) return;
    const count = (await this.adapter.read(address, rec.abi, "instanceCount")) as bigint;
    for (let id = 1n; id <= count; id++) {
      const [marking, ended] = (await this.adapter.read(address, rec.abi, "instances", [id])) as [bigint, boolean, Address];
      const inst = rec.instances.get(id) ?? { id, marking, ended, roles: {}, createdBlock: 0n };
      inst.marking = marking;
      inst.ended = ended;
      rec.instances.set(id, inst);
    }
    rec.paused = (await this.adapter.read(address, rec.abi, "paused")) as boolean;
  }

  snapshot(): IndexerSnapshot {
    return {
      processes: [...this.processes.values()].map((p) => ({
        address: p.address,
        ir: p.ir,
        abi: p.abi,
        owner: p.owner,
        deployedBlock: p.deployedBlock.toString(),
        paused: p.paused,
        lastBlock: p.lastBlock.toString(),
        instances: [...p.instances.values()].map((i) => ({ ...i, id: i.id.toString(), marking: i.marking.toString(), createdBlock: i.createdBlock.toString() })),
        timeline: p.timeline.map((t) => {
          const { marking, block, instance, ...rest } = t;
          return { ...rest, block: block.toString(), instance: instance.toString(), ...(marking !== undefined ? { marking: marking.toString() } : {}) };
        }),
      })),
    };
  }

  /** 스냅샷을 되살리고 각 프로세스를 lastBlock+1 부터 다시 구독한다. */
  restore(s: IndexerSnapshot): void {
    for (const p of s.processes) {
      const rec: ProcessRecord = {
        address: p.address, ir: p.ir, abi: p.abi, owner: p.owner, deployedBlock: BigInt(p.deployedBlock), paused: p.paused,
        lastBlock: BigInt(p.lastBlock), instances: new Map(), timeline: [],
      };
      for (const i of p.instances) rec.instances.set(BigInt(i.id), { ...i, id: BigInt(i.id), marking: BigInt(i.marking), createdBlock: BigInt(i.createdBlock) });
      rec.timeline = p.timeline.map((t) => {
        const { marking, block, instance, ...rest } = t;
        const entry: TimelineEntry = { ...rest, block: BigInt(block), instance: BigInt(instance) };
        if (marking !== undefined) entry.marking = BigInt(marking);
        return entry;
      });
      this.processes.set(p.address, rec);
      this.track(p.address, p.ir, p.abi, p.owner, rec.deployedBlock);
    }
  }
}

import { roleHash } from "./errors";
