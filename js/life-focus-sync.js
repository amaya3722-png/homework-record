/**
 * Life Focus 同步桥：把 Hermes/企微写入的今日重点合并到作业积分任务池。
 * 在线版使用同源 /api；file:// 本地版保持离线能力，不保存任何机器令牌。
 */
(function () {
    'use strict';

    var POLL_MS = 60 * 1000;
    var SOURCE = 'life-focus';
    var syncing = false;
    var lastResult = null;

    function activeDate() {
        if (typeof selectedDate !== 'undefined' && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) return selectedDate;
        var now = new Date();
        return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    }

    function isOnlineEdition() {
        return location.hostname.endsWith('.chatgpt.site') || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    }

    function api(path, options) {
        if (!isOnlineEdition()) return Promise.reject(new Error('本地文件模式不连接企微同步'));
        return fetch(path, Object.assign({
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' }
        }, options || {})).then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (body) {
                if (!response.ok) throw new Error(body.error || ('同步服务返回 ' + response.status));
                return body;
            });
        });
    }

    function stableLocalId(date, remoteId) {
        var input = date + ':' + remoteId;
        var hash = 2166136261;
        for (var i = 0; i < input.length; i++) {
            hash ^= input.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return 1800000000 + (Math.abs(hash) % 300000000);
    }

    function subjectFor(line) {
        return ({ '主线': '主线任务', '工作': '找工作', '家人': '家庭', '娱乐': '娱乐', '其他': '其他' })[line] || '其他';
    }

    function ensureAdultColors() {
        if (typeof SUBJECT_COLORS === 'undefined') return;
        var colors = { '主线任务': '#4CAF50', '找工作': '#2196F3', '家庭': '#FF9800', '娱乐': '#9C27B0', '其他': '#607D8B' };
        Object.keys(colors).forEach(function (key) {
            if (!SUBJECT_COLORS[key]) SUBJECT_COLORS[key] = colors[key];
        });
    }

    function mergeRemoteTasks(data) {
        if (typeof tasks === 'undefined' || !Array.isArray(tasks)) throw new Error('任务列表尚未初始化');
        ensureAdultColors();
        var changed = 0;
        (data.tasks || []).forEach(function (remote) {
            var existing = tasks.find(function (task) {
                return task.externalSource === SOURCE && task.externalTaskId === remote.taskId && task.date === data.date;
            });
            var status = remote.state === 'done' ? 'completed' : (remote.state === 'cancelled' ? 'completed' : 'pending');
            if (!existing) {
                tasks.push({
                    id: stableLocalId(data.date, remote.taskId),
                    name: remote.content,
                    subject: subjectFor(remote.line),
                    description: '[' + remote.line + '] 来自企微今日重点',
                    plannedDuration: remote.estimateMin || 45,
                    coins: Math.max(1, Math.ceil((remote.estimateMin || 45) / 45)),
                    actualDuration: 0,
                    status: status,
                    date: data.date,
                    aiEstimated: true,
                    externalSource: SOURCE,
                    externalTaskId: remote.taskId
                });
                changed++;
                return;
            }
            var next = {
                name: remote.content,
                subject: subjectFor(remote.line),
                plannedDuration: remote.estimateMin || existing.plannedDuration || 45
            };
            Object.keys(next).forEach(function (key) {
                if (existing[key] !== next[key]) { existing[key] = next[key]; changed++; }
            });
            if (remote.state !== 'open' && existing.status !== status) { existing.status = status; changed++; }
        });
        if (changed && typeof saveData === 'function') saveData();
        return changed;
    }

    function renderStatus(state, message) {
        var host = document.getElementById('lifeFocusSyncStatus');
        if (!host) return;
        host.className = 'life-sync-status life-sync-' + state;
        host.querySelector('.life-sync-message').textContent = message;
        var button = host.querySelector('button');
        if (button) button.disabled = syncing;
    }

    function refreshUi() {
        if (typeof renderTaskList === 'function') renderTaskList();
        if (typeof updateStatistics === 'function') updateStatistics();
        if (typeof renderCalendar === 'function') renderCalendar();
        if (window.TimeBlock && TimeBlock.refresh) TimeBlock.refresh();
    }

    function syncNow(options) {
        options = options || {};
        if (syncing) return Promise.resolve(lastResult);
        if (!isOnlineEdition()) {
            renderStatus('offline', '本地版仅演示；请打开在线版接收企微任务');
            return Promise.resolve(null);
        }
        syncing = true;
        renderStatus('syncing', '正在同步企微今日重点…');
        return api('/api/state?date=' + encodeURIComponent(activeDate()))
            .then(function (data) {
                var changed = mergeRemoteTasks(data);
                lastResult = data;
                if (changed) refreshUi();
                var count = (data.tasks || []).length;
                renderStatus('ready', count ? ('已同步 ' + count + ' 个今日重点' + (changed ? '，任务池已更新' : '')) : '企微还没有今天的重点');
                return data;
            })
            .catch(function (error) {
                renderStatus('error', '同步暂不可用：' + error.message);
                if (options.silent !== true) console.warn('[LifeFocusSync]', error);
                return null;
            })
            .finally(function () { syncing = false; });
    }

    function startPomodoro(task, minutes) {
        if (!task || task.externalSource !== SOURCE || !task.externalTaskId) return Promise.resolve(null);
        return api('/api/pomodoro', {
            method: 'POST',
            body: JSON.stringify({ action: 'start', date: task.date || activeDate(), taskId: task.externalTaskId, plannedMinutes: minutes || 45 })
        }).then(function (body) { return body.session || null; }).catch(function (error) {
            console.warn('[LifeFocusSync] 番茄钟开始记录失败:', error.message);
            return null;
        });
    }

    function finishPomodoro(sessionId, action) {
        if (!sessionId) return Promise.resolve(null);
        return api('/api/pomodoro', {
            method: 'POST',
            body: JSON.stringify({ action: action || 'complete', date: activeDate(), sessionId: sessionId })
        }).catch(function (error) {
            console.warn('[LifeFocusSync] 番茄钟结束记录失败:', error.message);
            return null;
        });
    }

    function mountStatus() {
        if (document.getElementById('lifeFocusSyncStatus')) return;
        var section = document.getElementById('timeBlockSection');
        if (!section || !section.parentNode) return;
        var bar = document.createElement('div');
        bar.id = 'lifeFocusSyncStatus';
        bar.className = 'life-sync-status life-sync-syncing';
        bar.innerHTML = '<span class="life-sync-dot"></span><span class="life-sync-message">准备同步企微今日重点…</span><button type="button">立即同步</button>';
        bar.querySelector('button').addEventListener('click', function () { syncNow(); });
        section.parentNode.insertBefore(bar, section);
    }

    window.LifeFocusSync = {
        syncNow: syncNow,
        startPomodoro: startPomodoro,
        finishPomodoro: finishPomodoro,
        isOnlineEdition: isOnlineEdition
    };

    function init() {
        mountStatus();
        syncNow({ silent: true });
        setInterval(function () { syncNow({ silent: true }); }, POLL_MS);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 1200); });
    else setTimeout(init, 1200);
})();
