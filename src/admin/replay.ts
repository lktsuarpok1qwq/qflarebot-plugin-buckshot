import { replayImportMarkup } from '../replay/viewer/tools.js';
import { replayStyle as viewerStyle, replayViewerMarkup, replayPlayerScript } from '../replay/viewer/player.js';
import { replayListMarkup, replayListScript, replayListStyle } from './replay-list.js';

export const replayStyle = replayListStyle + viewerStyle;
export const replayMarkup = '<section id="replay" role="tabpanel" hidden>' + replayImportMarkup + replayListMarkup + replayViewerMarkup + '</section>';
export const replayScript = replayPlayerScript + replayListScript;
