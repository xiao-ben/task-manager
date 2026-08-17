#!/usr/bin/env bash
# task-manager E2E 冒烟测试：API / sidecar / hooks / 前端页面
set -u
cd "$(dirname "$0")/.."

API="http://127.0.0.1:3001"
TOKEN="dev-token-change-me"
SIDECAR="http://127.0.0.1:3927"
DAY="$(date +%F)"
PASS=0; FAIL=0

ok()   { PASS=$((PASS+1)); echo "  ✅ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ❌ $1"; }
check(){ # $1 desc  $2 actual  $3 expected-substr
  if echo "$2" | grep -q -- "$3"; then ok "$1"; else bad "$1 -> 期望包含 [$3]，实际: $(echo "$2" | head -c 200)"; fi
}

echo "== A. API 服务 =="
H=$(curl -s -m 5 "$API/api/health")
check "health 正常" "$H" '"ok":true'
check "内存库模式" "$H" '"memory":true'

R=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "$API/api/tasks?day=$DAY")
check "无 token 返回 401" "$R" "401"

echo "== B. 任务 CRUD + 乐观锁 =="
CREATED=$(curl -s -m 5 -X POST "$API/api/tasks" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"title\":\"E2E 测试任务\",\"day\":\"$DAY\",\"source\":\"manual\"}")
TID=$(echo "$CREATED" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
check "创建任务" "$CREATED" '"title":"E2E 测试任务"'
UPDATED_AT=$(echo "$CREATED" | sed -n 's/.*"updatedAt":"\([^"]*\)".*/\1/p' | head -1)

LIST=$(curl -s -m 5 "$API/api/tasks?day=$DAY" -H "Authorization: Bearer $TOKEN")
check "按日查询包含新任务" "$LIST" "$TID"

P1=$(curl -s -m 5 -X PATCH "$API/api/tasks/$TID" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"status\":\"doing\",\"expectedUpdatedAt\":\"$UPDATED_AT\"}")
check "PATCH(正确版本) -> doing" "$P1" '"status":"doing"'

P2=$(curl -s -m 5 -o /dev/null -w "%{http_code}" -X PATCH "$API/api/tasks/$TID" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"status\":\"done\",\"expectedUpdatedAt\":\"$UPDATED_AT\"}")
check "PATCH(过期版本) -> 409 冲突" "$P2" "409"

echo "== C. 仓库 upsert 幂等 =="
R1=$(curl -s -m 5 -X POST "$API/api/repos" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"e2e-repo","path":"/tmp/e2e-repo"}')
RID1=$(echo "$R1" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
R2=$(curl -s -m 5 -X POST "$API/api/repos" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"e2e-repo-2","path":"/tmp/e2e-repo"}')
RID2=$(echo "$R2" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
if [ -n "$RID1" ] && [ "$RID1" = "$RID2" ]; then ok "同路径 upsert 幂等 (id 相同)"; else bad "upsert 幂等失败: $RID1 vs $RID2"; fi
RLIST=$(curl -s -m 5 "$API/api/repos" -H "Authorization: Bearer $TOKEN")
check "仓库列表" "$RLIST" "/tmp/e2e-repo"

echo "== D. 总结（草稿 + 保存） =="
S1=$(curl -s -m 5 "$API/api/summaries?type=day&key=$DAY&draft=1" -H "Authorization: Bearer $TOKEN")
check "草稿生成" "$S1" '"draft"'
S2=$(curl -s -m 5 -X PUT "$API/api/summaries" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"periodType\":\"day\",\"periodKey\":\"$DAY\",\"content\":\"E2E 总结内容\"}")
check "保存总结" "$S2" "E2E 总结内容"
S3=$(curl -s -m 5 "$API/api/summaries?type=day&key=$DAY" -H "Authorization: Bearer $TOKEN")
check "读回总结" "$S3" "E2E 总结内容"

echo "== E2. Agent 运行记录 =="
AR=$(curl -s -m 5 -X POST "$API/api/agent-runs" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"taskId\":\"$TID\",\"agentId\":\"agent-e2e\",\"runId\":\"run-e2e\"}")
ARID=$(echo "$AR" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
check "创建运行记录" "$AR" '"status":"running"'
ARP=$(curl -s -m 5 -X PATCH "$API/api/agent-runs/$ARID" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"done","result":"ok","transcript":"[]"}')
check "回写运行结果" "$ARP" '"status":"done"'
check "finishedAt 自动落库" "$ARP" '"finishedAt":"'
ARL=$(curl -s -m 5 "$API/api/agent-runs?taskId=$TID" -H "Authorization: Bearer $TOKEN")
check "按任务查询运行记录" "$ARL" "agent-e2e"

echo "== E. Sidecar =="
SH=$(curl -s -m 5 "$SIDECAR/health")
check "sidecar health" "$SH" '"ok":true'
WS=$(curl -s -m 5 "$SIDECAR/cursor/workspaces")
WCOUNT=$(echo "$WS" | grep -o '"path"' | wc -l | tr -d ' ')
check "Cursor 工作区读取 ($WCOUNT 个)" "$WS" '"workspaces"'
AG=$(curl -s -m 15 -X POST "$SIDECAR/agent/start" -H "Content-Type: application/json" \
  -d "{\"taskId\":\"$TID\",\"prompt\":\"test\",\"cwd\":\"/tmp\"}")
if echo "$AG" | grep -q "CURSOR_API_KEY"; then
  ok "Agent 校验（无 key 时明确报错）"
elif echo "$AG" | grep -q '"agentId"'; then
  ok "Agent 真实启动成功"
else
  bad "agent/start 返回异常: $(echo "$AG" | head -c 160)"
fi

echo "== F. Cursor Hooks 端到端 =="
SID="e2e-session-$(date +%s)"
echo "{\"conversation_id\":\"$SID\",\"conversation_title\":\"E2E hook 会话\",\"workspace_roots\":[\"/tmp/e2e-repo\"]}" \
  | TASK_MANAGER_API_BASE="$API" TASK_MANAGER_TOKEN="$TOKEN" node hooks-templates/task-manager-session-start.mjs >/dev/null
sleep 1
HQ=$(curl -s -m 5 "$API/api/tasks?cursorSessionId=$SID" -H "Authorization: Bearer $TOKEN")
check "sessionStart 自动建任务" "$HQ" '"source":"cursor"'
check "自动任务绑定 workspace" "$HQ" "/tmp/e2e-repo"
HTID=$(echo "$HQ" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)

# 重复触发不应重复建任务
echo "{\"conversation_id\":\"$SID\",\"conversation_title\":\"E2E hook 会话\"}" \
  | TASK_MANAGER_API_BASE="$API" TASK_MANAGER_TOKEN="$TOKEN" node hooks-templates/task-manager-session-start.mjs >/dev/null
sleep 1
DUP=$(curl -s -m 5 "$API/api/tasks?cursorSessionId=$SID" -H "Authorization: Bearer $TOKEN" | grep -o '"id"' | wc -l | tr -d ' ')
if [ "$DUP" = "1" ]; then ok "sessionStart 幂等（不重复建）"; else bad "sessionStart 重复建任务 ($DUP)"; fi

echo "{\"conversation_id\":\"$SID\"}" \
  | TASK_MANAGER_API_BASE="$API" TASK_MANAGER_TOKEN="$TOKEN" node hooks-templates/task-manager-stop.mjs >/dev/null
sleep 1
HQ2=$(curl -s -m 5 "$API/api/tasks?cursorSessionId=$SID" -H "Authorization: Bearer $TOKEN")
check "stop 自动标记完成" "$HQ2" '"status":"done"'

echo "== G. 前端页面烟测 =="
for route in day week settings widget; do
  DOM=$(curl -s -m 5 "http://127.0.0.1:1420/#/$route" )
  check "路由 /$route 可访问" "$DOM" "<div id=\"root\">"
done

echo "== 清理测试数据 =="
curl -s -m 5 -X DELETE "$API/api/tasks/$TID" -H "Authorization: Bearer $TOKEN" >/dev/null
[ -n "${HTID:-}" ] && curl -s -m 5 -X DELETE "$API/api/tasks/$HTID" -H "Authorization: Bearer $TOKEN" >/dev/null
curl -s -m 5 -X DELETE "$API/api/repos/$RID1" -H "Authorization: Bearer $TOKEN" >/dev/null
LEFT=$(curl -s -m 5 "$API/api/tasks?day=$DAY" -H "Authorization: Bearer $TOKEN")
echo "$LEFT" | grep -q "E2E" && bad "清理残留" || ok "测试数据已清理"

echo ""
echo "======== 结果: $PASS 通过 / $FAIL 失败 ========"
exit $FAIL
