/**
 * Shared Data Loader — 从 GitHub Pages 加载共享作业数据
 *
 * 数据流：
 * 1. 页面初始化时 fetch('data.json') 拉取共享作业
 * 2. 转换为 app.js 的 task 格式
 * 3. 与 localStorage 合并（completion 状态以 localStorage 为准）
 * 4. 新作业自动追加到 tasks 数组
 *
 * Hermes bot 负责更新 data.json → git push → GitHub Pages 自动部署
 */

(function() {
    'use strict';

    var DATA_URL = 'data.json';

    /**
     * 从远程加载共享作业数据
     * @returns {Promise<Object|null>} 解析后的 data.json 内容
     */
    function fetchSharedData() {
        return fetch(DATA_URL, { cache: 'no-cache' })
            .then(function(response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })
            .then(function(data) {
                if (data && data.entries && typeof data.entries === 'object') {
                    return data;
                }
                throw new Error('Invalid data.json format');
            })
            .catch(function(err) {
                console.warn('[DataLoader] 无法加载共享数据，使用离线模式:', err.message);
                return null;
            });
    }

    /**
     * 将 data.json 中的作业条目转换为 app.js task 格式
     * @param {Object} sharedData — data.json 内容
     * @param {string} dateStr — 目标日期 (YYYY-MM-DD)
     * @param {Array} existingTasks — 现有的 tasks 数组（用于检测重复）
     * @returns {Array} 新生成的 task 对象数组
     */
    function convertToTasks(sharedData, dateStr, existingTasks) {
        if (!sharedData || !sharedData.entries || !sharedData.entries[dateStr]) {
            return [];
        }

        var entry = sharedData.entries[dateStr];
        var now = Date.now();
        var newTasks = [];
        var taskIndex = 0;

        entry.subjects.forEach(function(subject) {
            subject.tasks.forEach(function(taskInfo) {
                // 检查是否已存在（同日期 + 同学科 + 同名）
                var exists = existingTasks.some(function(t) {
                    return t.date === dateStr &&
                        t.subject === subject.name &&
                        t.name === taskInfo.title;
                });

                if (exists) return; // 跳过重复

                newTasks.push({
                    id: now + taskIndex,
                    name: taskInfo.title,
                    subject: subject.name,
                    description: taskInfo.title,  // 共享数据可能只有标题
                    plannedDuration: taskInfo.estimatedMinutes || 15,
                    actualDuration: 0,
                    status: 'pending',
                    date: dateStr,
                    coins: 1,
                    aiEstimated: true,  // 标记为 AI 估算
                    fromShared: true     // 标记来源为共享数据
                });

                taskIndex++;
            });
        });

        return newTasks;
    }

    /**
     * 合并共享数据到现有 tasks 数组
     * - 新增远程有但本地没有的任务
     * - 保留本地 completion 状态
     * - 不清除本地手动添加的任务
     *
     * @param {Array} existingTasks — 当前 tasks 数组
     * @param {Object|null} sharedData — data.json 内容
     * @returns {Object} { tasks, sharedUpdated, addedCount }
     */
    function mergeSharedData(existingTasks, sharedData) {
        if (!sharedData) {
            return { tasks: existingTasks, sharedUpdated: null, addedCount: 0 };
        }

        // 取最近 7 天的日期（包含今天），避免加载过多历史数据
        var dates = [];
        var today = new Date();
        for (var i = 6; i >= 0; i--) {
            var d = new Date(today);
            d.setDate(d.getDate() - i);
            dates.push(d.toISOString().split('T')[0]);
        }

        var allNewTasks = [];
        dates.forEach(function(dateStr) {
            var newTasks = convertToTasks(sharedData, dateStr, existingTasks.concat(allNewTasks));
            allNewTasks = allNewTasks.concat(newTasks);
        });

        var mergedTasks = existingTasks.concat(allNewTasks);

        return {
            tasks: mergedTasks,
            sharedUpdated: sharedData.updated || null,
            addedCount: allNewTasks.length
        };
    }

    // 暴露到全局
    window.SharedDataLoader = {
        fetchSharedData: fetchSharedData,
        mergeSharedData: mergeSharedData,
        convertToTasks: convertToTasks
    };
})();
