/* MCP tools: open questions, discussions and comments on catalog objects. */
import { readTable, iso } from "../lookups.js";
import { S, str, int, enumT } from "../schema.js";

export default ({ readCatalog, collab, currentUser }) => [
  /* ── collaboration (v1.58) ── */
  ...(collab ? [
  { name: "list_open_questions", description: "Open questions users asked on catalog objects (Discussion tab) that still wait for an answer or resolution.",
    inputSchema: S({ limit: int("Max entries (default 50, max 200)", { min: 1, max: 200 }) }),
    run: async (a) => (await collab.open(a.limit || 50)).map((qn) => ({ id: qn.id, type: qn.entityType, path: qn.path, question: qn.body, asked_by: qn.by.name, asked_at: iso(qn.ts) })) },
  { name: "get_discussion", description: "Comments, questions and answers plus rating and usage statistics of a table ('database.schema.table').",
    inputSchema: S({ table: str("Table path 'database.schema.table'") }, ["table"]),
    run: async (a) => { const { tb } = await readTable(readCatalog, a.table); const co = await collab.of("table", tb.id);
      return { rating: co.rating, usage: co.usage, threads: co.comments.map((t) => ({ id: t.id, kind: t.kind, by: t.by.name, at: iso(t.ts), body: t.body, resolved: !!t.resolvedTs,
        replies: t.replies.map((r) => ({ id: r.id, by: r.by.name, at: iso(r.ts), body: r.body })) })) }; } },
  { name: "add_comment", mutating: true, description: "Post a comment, a question (notifies steward and owner) or an answer (reply_to = question id) on a table. Audited under the caller's identity.",
    inputSchema: S({ table: str("Table path 'database.schema.table'"), body: str("Text (max 4000 characters)"), kind: enumT(["comment", "question", "answer"], "comment | question | answer (default comment)"), reply_to: str("Id of the comment or question this replies to (optional)") }, ["table", "body"]),
    run: async (a) => { const { tb } = await readTable(readCatalog, a.table);
      const u = currentUser(); const cm = await collab.add("table", tb.id, u, { body: a.body, kind: a.kind || (a.reply_to ? "answer" : "comment"), parentId: a.reply_to || null });
      if (cm.kind === "question") await collab.notifyQuestion("table", tb.id, cm, u).catch(() => 0);
      return { id: cm.id, kind: cm.kind, table: a.table, posted_at: iso(cm.ts) }; } },
  ] : []),
];
