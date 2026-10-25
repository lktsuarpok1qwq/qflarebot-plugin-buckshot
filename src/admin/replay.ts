import { replayImportMarkup } from '../replay/viewer/tools.js';
import { replayStyle as viewerStyle, replayViewerMarkup, replayPlayerScript } from '../replay/viewer/player.js';
import { replayListMarkup, replayListScript, replayListStyle } from './replay-list.js';

export const replayStyle = replayListStyle + viewerStyle;
export const replayMarkup = '<section id="replay" role="tabpanel" hidden>' + '<div id="replayBrowse">' + replayImportMarkup + replayListMarkup + '</div><div id="replayDetail" hidden><div class="actions"><button id="replayBack">← 返回列表</button></div>' + replayViewerMarkup + '<details id="replayAdminDetails" class="qb-card" hidden><summary>管理员对局详情</summary><p id="replayAdminStyle"></p></details></div>' + '</section>';
export const replayScript = replayPlayerScript + replayListScript;
