import { pointsScript } from './points.js';
import { roomsScript } from './rooms.js';
import { feedbackScript } from './feedback.js';
import { statisticsMarkup, statisticsScript, statisticsStyle } from './statistics.js';
import { replayMarkup, replayScript, replayStyle } from './replay.js';
import { configForm } from './config-form.js';
import { roomExplanationScript, roomExplanationStyle } from './room-explanation.js';

export const page = String.raw`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/tokens.css">
<style>
*{box-sizing:border-box;scrollbar-width:thin;scrollbar-color:var(--qb-border-strong) transparent}body{margin:0;color:var(--qb-fg);background:var(--qb-bg);font:var(--qb-text-base)/var(--qb-leading) var(--qb-font-sans)}#content{padding:16px;min-width:0}.tabs,.actions{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px}.qb-card{margin-bottom:16px;padding:16px}#configForm .config-section{min-width:0;margin:16px 0;padding:12px;border:1px solid var(--qb-border);border-radius:var(--qb-radius)}#configForm summary{cursor:pointer}#configForm legend,#configForm summary{font-weight:600;padding:0 8px}.row{display:grid;grid-template-columns:minmax(150px,1fr) minmax(160px,1fr);align-items:center;gap:16px;padding:10px 0}.config-controls input:disabled{opacity:.65}#cfg-multipliers{display:grid;gap:8px}#cfg-multipliers label{display:flex;align-items:center;justify-content:space-between;gap:12px}#cfg-multipliers input{max-width:160px}.row input{width:100%;min-width:0}button,input{font:inherit}button,input,select{border:1px solid var(--qb-border-strong);border-radius:var(--qb-radius);background:var(--qb-input);color:var(--qb-fg);padding:7px 12px}button{cursor:pointer;border-radius:var(--qb-radius-full);background:var(--qb-surface)}button[aria-selected=true]{background:var(--qb-primary);color:var(--qb-on-primary)}button:disabled{opacity:.5;cursor:default}:focus-visible{outline:2px solid var(--qb-ring);outline-offset:2px}h2{font-size:var(--qb-text-lg);margin:0 0 12px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:var(--qb-text-sm)/1.7 var(--qb-font-mono);max-height:480px;overflow:auto}input[type=checkbox]{width:22px;height:22px;accent-color:var(--qb-accent)}.hint{color:var(--qb-fg-muted)}.danger{color:var(--qb-danger)}.viewport-probe{position:fixed;inset:0;pointer-events:none;visibility:hidden}dialog{margin:0;position:fixed;top:var(--dialog-top,50%);left:var(--dialog-left,50%);transform:translate(-50%,-50%);max-height:calc(var(--dialog-height,100vh) - 32px);overflow:auto;border:1px solid var(--qb-border);border-radius:var(--qb-radius-xl);background:var(--qb-surface);color:var(--qb-fg);max-width:min(480px,calc(var(--dialog-width,100vw) - 32px));box-shadow:var(--qb-shadow);padding:24px}dialog::backdrop{background:var(--qb-overlay,rgba(0,0,0,.4))}#toasts{position:fixed;top:12px;right:12px;max-width:80vw;z-index:20}.toast{padding:12px;border-radius:var(--qb-radius);background:var(--qb-surface);box-shadow:var(--qb-shadow);margin-bottom:8px}.skeleton{height:72px;border-radius:var(--qb-radius);background:var(--qb-surface-muted)}@media(max-width:600px){.row{grid-template-columns:1fr;gap:6px}button,input{min-height:44px}.qb-card{padding:12px}}@media(prefers-reduced-motion:reduce){*{animation:none!important;scroll-behavior:auto!important}}
/* BUCKSHOT_REPLAY_STYLE */
/* BUCKSHOT_STATISTICS_STYLE */
/* BUCKSHOT_ROOM_EXPLANATION_STYLE */
</style></head><body class="qb-page"><main id="content">
<nav class="tabs" role="tablist"><button role="tab" aria-selected="true" data-tab="rooms">房间</button><button role="tab" aria-selected="false" data-tab="config" tabindex="-1">游戏配置</button><button role="tab" aria-selected="false" data-tab="points" tabindex="-1">积分与占用</button><button role="tab" aria-selected="false" data-tab="replay" tabindex="-1">对局回放</button><button role="tab" aria-selected="false" data-tab="statistics" tabindex="-1">数据分析</button></nav>
<section id="rooms" role="tabpanel"><div class="qb-card"><div class="actions"><button id="loadRooms">加载房间</button></div><div id="roomList" class="hint">尚未加载</div><div class="actions"><button id="nextRooms" disabled>下一页</button></div><p id="roomObservation" class="hint">索引用于发现房间，详情以房间实际状态为准</p></div>
<div class="qb-card"><div class="actions"><input id="group" aria-label="群 OpenID" placeholder="群 OpenID"><button id="loadRoom">查询详情</button><button id="collapseRoom" disabled>收起</button></div><div id="roomView"></div><div id="roomActions" class="actions"></div><button id="checkRoom" hidden>核对房间操作</button></div></section>
<section id="config" role="tabpanel" hidden><div class="qb-card"><div class="actions"><button id="loadConfig">加载配置</button></div><p id="configStatus" class="hint">尚未加载</p><form id="configForm" hidden></form><p class="hint">所有群聊与私聊使用同一套配置。房间沿用创建时配置，修改只对新房间生效；普通消息及私聊情报均按撤回配置清理。</p><p id="configErrors" role="alert" class="danger"></p><div class="actions"><button id="saveConfig" disabled>保存</button><button id="undoConfig" disabled>撤销修改</button><button id="checkConfig" hidden>核对保存结果</button></div></div></section>
<section id="points" role="tabpanel" hidden><div class="qb-card"><h2>积分来源</h2><div class="actions"><button id="pointsQuery">查询授权</button><button id="pointsRegister">登记来源</button></div><pre id="pointsResult">尚未查询</pre></div><div class="qb-card"><h2>玩家占用</h2><div class="actions"><input id="userId" placeholder="玩家 OpenID" aria-label="玩家 OpenID"><button id="ownerQuery">查询</button><button id="ownerRepair">修复已关闭房间占用</button></div><pre id="ownerResult">尚未查询</pre></div></section>
<!-- BUCKSHOT_REPLAY_MARKUP -->
<!-- BUCKSHOT_STATISTICS_MARKUP -->
</main><div id="toasts" aria-live="polite"></div><dialog id="confirm" aria-labelledby="confirmTitle" aria-describedby="confirmText"><h2 id="confirmTitle">确认操作</h2><p id="confirmText"></p><div class="actions"><button id="cancel">取消</button><button id="accept" class="danger">确认</button></div></dialog>
<script type="module">
${feedbackScript}let active = 'rooms', epoch = { rooms: 0, config: 0, points: 0, replay: 0, statistics: 0 };
const tabs = [...document.querySelectorAll('[data-tab]')];

function tab(name) {
    if (active === 'replay' && name !== 'replay') { stopReplay(); }

    epoch[active]++;
    active = name;

    for (const t of tabs) {
        const on = t.dataset.tab === name;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        $(t.dataset.tab).hidden = !on;
    }
}

for (const [index, t] of tabs.entries()) {
    t.onclick = () => tab(t.dataset.tab);
    t.onkeydown = e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const next = tabs[(index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
            next.click();
            next.focus();
        }
    };
}

${roomsScript}/* BUCKSHOT_REPLAY_SCRIPT */
/* BUCKSHOT_STATISTICS_SCRIPT */
/* BUCKSHOT_CONFIG_FORM */
${pointsScript}</script></body></html>`.replace('/* BUCKSHOT_CONFIG_FORM */', () => configForm).replace('/* BUCKSHOT_REPLAY_STYLE */', () => replayStyle).replace('<!-- BUCKSHOT_REPLAY_MARKUP -->', () => replayMarkup).replace('/* BUCKSHOT_REPLAY_SCRIPT */', () => replayScript).replace('/* BUCKSHOT_STATISTICS_STYLE */', () => statisticsStyle).replace('<!-- BUCKSHOT_STATISTICS_MARKUP -->', () => statisticsMarkup).replace('/* BUCKSHOT_STATISTICS_SCRIPT */', () => statisticsScript).replace('/* BUCKSHOT_ROOM_EXPLANATION_STYLE */', () => roomExplanationStyle).replace('/* BUCKSHOT_ROOM_EXPLANATION_SCRIPT */', () => roomExplanationScript);
