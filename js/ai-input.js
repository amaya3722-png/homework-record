/**
 * AI 智能作业录入模块
 * 功能：OCR图片识别、LLM文本结构化、任务自动创建、时间估算、日期导航
 * 依赖：app.js (全局变量和函数)、tesseract.js (CDN)
 */

(function() {
    'use strict';

    // ==================== AI 设置状态 ====================
    var aiSettings = {
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        apiKey: '',
        model: 'deepseek-chat'
    };

    // ==================== AI 输入状态 ====================
    var aiImages = [];
    var aiOcrResults = [];
    var aiParsedTasks = null;
    var currentAiMode = 'text';

    // ==================== 设置管理 ====================
    function loadAiSettings() {
        try {
            var key = 'aiSettings_' + (typeof currentUserId !== 'undefined' ? currentUserId : 'default');
            var saved = localStorage.getItem(key);
            if (saved) {
                var parsed = JSON.parse(saved);
                aiSettings.provider = parsed.provider || aiSettings.provider;
                aiSettings.baseUrl = parsed.baseUrl || aiSettings.baseUrl;
                aiSettings.apiKey = parsed.apiKey || '';
                aiSettings.model = parsed.model || aiSettings.model;
            }
        } catch (e) {
            console.error('加载AI设置失败:', e);
        }
    }

    function saveAiSettings() {
        try {
            var key = 'aiSettings_' + (typeof currentUserId !== 'undefined' ? currentUserId : 'default');
            localStorage.setItem(key, JSON.stringify(aiSettings));
        } catch (e) {
            console.error('保存AI设置失败:', e);
        }
    }

    function getUserId() {
        return typeof currentUserId !== 'undefined' ? currentUserId : 'default';
    }

    // ==================== AI 输入区 UI ====================
    function toggleAiInput() {
        var body = document.getElementById('aiInputBody');
        var icon = document.getElementById('aiToggleIcon');
        if (!body || !icon) return;
        var isHidden = body.classList.contains('hidden');
        if (isHidden) {
            body.classList.remove('hidden');
            icon.style.transform = 'rotate(180deg)';
        } else {
            body.classList.add('hidden');
            icon.style.transform = 'rotate(0deg)';
        }
    }

    function switchAiMode(mode) {
        currentAiMode = mode;
        var textPanel = document.getElementById('aiTextPanel');
        var imagePanel = document.getElementById('aiImagePanel');
        var tabText = document.getElementById('aiTabText');
        var tabImage = document.getElementById('aiTabImage');

        if (!textPanel || !imagePanel || !tabText || !tabImage) return;

        if (mode === 'text') {
            textPanel.classList.remove('hidden');
            imagePanel.classList.add('hidden');
            tabText.className = 'flex-1 py-2 px-3 bg-purple-100 text-purple-700 rounded-lg text-sm font-medium min-h-[44px]';
            tabImage.className = 'flex-1 py-2 px-3 bg-gray-100 text-gray-500 rounded-lg text-sm font-medium min-h-[44px]';
        } else {
            textPanel.classList.add('hidden');
            imagePanel.classList.remove('hidden');
            tabText.className = 'flex-1 py-2 px-3 bg-gray-100 text-gray-500 rounded-lg text-sm font-medium min-h-[44px]';
            tabImage.className = 'flex-1 py-2 px-3 bg-purple-100 text-purple-700 rounded-lg text-sm font-medium min-h-[44px]';
        }
    }

    // ==================== 图片处理 ====================
    function handleImageFiles(files) {
        if (!files || files.length === 0) return;

        Array.from(files).forEach(function(file) {
            if (!file.type.match(/^image\//)) {
                if (typeof showNotification === 'function') {
                    showNotification('仅支持图片文件，请重新选择', 'warning');
                }
                return;
            }

            var reader = new FileReader();
            reader.onload = function(e) {
                aiImages.push({
                    file: file,
                    dataUrl: e.target.result,
                    name: file.name
                });
                renderImagePreviews();
            };
            reader.readAsDataURL(file);
        });
    }

    function removeImage(index) {
        aiImages.splice(index, 1);
        renderImagePreviews();
    }

    function renderImagePreviews() {
        var container = document.getElementById('imagePreviewList');
        if (!container) return;

        if (aiImages.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = aiImages.map(function(img, idx) {
            return '<div class="relative inline-block">' +
                '<img src="' + img.dataUrl + '" class="w-20 h-20 object-cover rounded-lg border border-gray-200" alt="preview">' +
                '<button class="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 transition-colors" onclick="window._aiRemoveImage(' + idx + ')">×</button>' +
                '</div>';
        }).join('');
    }

    // 全局函数供 onclick 使用
    window._aiRemoveImage = function(index) {
        removeImage(index);
    };

    // ==================== OCR 识别 ====================
    function performOCR() {
        if (aiImages.length === 0) {
            if (typeof showNotification === 'function') {
                showNotification('请先上传图片', 'warning');
            }
            return;
        }

        if (typeof Tesseract === 'undefined') {
            if (typeof showNotification === 'function') {
                showNotification('OCR 引擎正在加载中，请稍后再试', 'warning');
            }
            return;
        }

        var progressEl = document.getElementById('ocrProgress');
        var progressBar = document.getElementById('ocrProgressBar');
        var progressText = document.getElementById('ocrProgressText');
        var ocrBtn = document.getElementById('aiOcrBtn');

        if (progressEl) progressEl.classList.remove('hidden');
        if (ocrBtn) {
            ocrBtn.disabled = true;
            ocrBtn.textContent = '识别中...';
        }

        aiOcrResults = [];

        function processNext(index) {
            if (index >= aiImages.length) {
                // All done
                if (progressBar) progressBar.style.width = '100%';
                if (progressText) progressText.textContent = '识别完成！共识别 ' + aiImages.length + ' 张图片';

                // Combine results into textarea
                var textarea = document.getElementById('aiTextInput');
                if (textarea) {
                    textarea.value = aiOcrResults.join('\n---\n');
                }
                switchAiMode('text');

                setTimeout(function() {
                    if (progressEl) progressEl.classList.add('hidden');
                    if (ocrBtn) {
                        ocrBtn.disabled = false;
                        ocrBtn.innerHTML = '<i class="fa fa-search mr-1"></i> 开始识别文字';
                    }
                }, 2000);

                if (typeof showNotification === 'function') {
                    showNotification('文字识别完成，请校对结果', 'success');
                }
                return;
            }

            if (progressText) {
                progressText.textContent = '正在识别第 ' + (index + 1) + '/' + aiImages.length + ' 张图片...';
            }

            Tesseract.recognize(
                aiImages[index].dataUrl,
                'chi_sim',
                {
                    logger: function(m) {
                        if (m.status === 'recognizing text' && m.progress) {
                            var pct = Math.round(m.progress * 100);
                            var overallPct = Math.round(((index + m.progress) / aiImages.length) * 100);
                            if (progressBar) progressBar.style.width = overallPct + '%';
                        }
                    }
                }
            ).then(function(result) {
                var text = result.data.text.trim();
                if (text) {
                    aiOcrResults.push(text);
                } else {
                    aiOcrResults.push('【第 ' + (index + 1) + ' 张图片未识别到文字】');
                }
                processNext(index + 1);
            }).catch(function(err) {
                console.error('OCR 错误:', err);
                aiOcrResults.push('【第 ' + (index + 1) + ' 张图片识别失败】');
                processNext(index + 1);
            });
        }

        processNext(0);
    }

    // ==================== LLM API 调用 ====================
    var AI_SYSTEM_PROMPT = '你是一个小学作业整理助手。用户会提供一段文字（通常是老师发的作业通知），请从中提取作业信息并返回严格的JSON格式。\n\n规则：\n1. 日期：如果文字中提到了日期（如"今天的作业"、"周三作业"、"6月15日"），请推断出具体日期。如果没有明确提到日期，使用用户提供的今天日期。\n2. dayOfWeek：根据日期计算是星期几（如"星期一"、"星期二"）\n3. 支持的学科包括但不限于：语文、数学、英语、科学、道法（道德与法治）、美术、音乐、体育、劳动、信息（信息技术）、书法、综合实践\n4. 每个学科下的tasks数组，每个task有title和estimatedMinutes\n5. estimatedMinutes根据作业内容和难度合理推断，按照小学生标准：\n   - 练字/写字/生字：10-15分钟\n   - 口算/计算/算术：10-15分钟\n   - 练习册/同步练习/一课一练：15-20分钟\n   - 阅读/朗读/背诵：15-20分钟\n   - 试卷/测试卷/单元卷：30-40分钟\n   - 作文/日记/写话：25-30分钟\n   - 预习/复习：10-15分钟\n   - APP作业/打卡：10-15分钟\n   - 手工/画画：20-30分钟\n   - 其他未明确类型：默认15分钟\n6. 如果文字中某条作业没有明确指定学科，根据内容合理推断\n7. 每项作业的title应该简洁明确，保留关键信息（如页码、章节、名称）\n\n返回格式（仅返回JSON，不要额外说明文字）：\n{\n  "date": "YYYY-MM-DD",\n  "dayOfWeek": "星期X",\n  "subjects": [\n    {\n      "name": "学科名称",\n      "tasks": [\n        {"title": "具体作业内容", "estimatedMinutes": 15}\n      ]\n    }\n  ]\n}';

    function callLLM(text) {
        return new Promise(function(resolve, reject) {
            if (!aiSettings.apiKey) {
                if (typeof showNotification === 'function') {
                    showNotification('请先在"我的"页面配置 AI API Key', 'warning');
                }
                resolve(null);
                return;
            }

            var todayDate = typeof selectedDate !== 'undefined' ? selectedDate : '';
            var userMessage = '请整理以下作业通知：\n\n' + text + '\n\n今天的日期是：' + todayDate;

            var url, headers, body;

            if (aiSettings.provider === 'anthropic') {
                url = (aiSettings.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '') + '/v1/messages';
                headers = {
                    'Content-Type': 'application/json',
                    'x-api-key': aiSettings.apiKey,
                    'anthropic-version': '2023-06-01'
                };
                body = {
                    model: aiSettings.model || 'claude-3-haiku-20240307',
                    max_tokens: 2048,
                    system: AI_SYSTEM_PROMPT,
                    messages: [
                        { role: 'user', content: userMessage }
                    ]
                };
            } else {
                // OpenAI 兼容
                url = (aiSettings.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '') + '/chat/completions';
                headers = {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + aiSettings.apiKey
                };
                body = {
                    model: aiSettings.model || 'gpt-3.5-turbo',
                    max_tokens: 2048,
                    messages: [
                        { role: 'system', content: AI_SYSTEM_PROMPT },
                        { role: 'user', content: userMessage }
                    ]
                };
            }

            fetch(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(body)
            }).then(function(response) {
                if (!response.ok) {
                    return response.text().then(function(txt) {
                        var errMsg = 'API 请求失败: HTTP ' + response.status;
                        try {
                            var errData = JSON.parse(txt);
                            if (errData.error && errData.error.message) {
                                errMsg = errData.error.message;
                            }
                        } catch (e) {}
                        throw new Error(errMsg);
                    });
                }
                return response.json();
            }).then(function(data) {
                var content;
                if (aiSettings.provider === 'anthropic') {
                    if (data.content && data.content.length > 0 && data.content[0].text) {
                        content = data.content[0].text;
                    } else {
                        throw new Error('API 返回格式异常');
                    }
                } else {
                    if (data.choices && data.choices.length > 0 && data.choices[0].message) {
                        content = data.choices[0].message.content;
                    } else {
                        throw new Error('API 返回格式异常');
                    }
                }

                var parsed = parseLLMResponse(content);
                resolve(parsed);
            }).catch(function(err) {
                console.error('LLM API 错误:', err);
                if (typeof showNotification === 'function') {
                    showNotification('AI 请求失败: ' + err.message, 'error');
                }
                resolve(null);
            });
        });
    }

    function parseLLMResponse(content) {
        if (!content || typeof content !== 'string') return null;

        var jsonStr = content.trim();

        // 尝试提取 markdown 代码块中的 JSON
        var codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch) {
            jsonStr = codeBlockMatch[1].trim();
        }

        // 如果内容以 { 开头但不是以 } 结尾，尝试找到第一个完整的 JSON 对象
        if (jsonStr.indexOf('{') === 0 && jsonStr.lastIndexOf('}') !== jsonStr.length - 1) {
            var lastBrace = jsonStr.lastIndexOf('}');
            if (lastBrace > 0) {
                jsonStr = jsonStr.substring(0, lastBrace + 1);
            }
        }

        try {
            var parsed = JSON.parse(jsonStr);

            // 验证基本结构
            if (!parsed.subjects || !Array.isArray(parsed.subjects)) {
                throw new Error('返回数据缺少 subjects 数组');
            }

            // 验证每个 subject
            for (var i = 0; i < parsed.subjects.length; i++) {
                var subj = parsed.subjects[i];
                if (!subj.name || !subj.tasks || !Array.isArray(subj.tasks)) {
                    throw new Error('学科 ' + (i + 1) + ' 数据格式不正确');
                }
                for (var j = 0; j < subj.tasks.length; j++) {
                    var t = subj.tasks[j];
                    if (!t.title) {
                        throw new Error('学科 "' + subj.name + '" 中的第 ' + (j + 1) + ' 个任务缺少标题');
                    }
                    if (!t.estimatedMinutes || t.estimatedMinutes < 1) {
                        t.estimatedMinutes = 15; // 默认值
                    }
                }
            }

            // 如果没有日期，使用当天
            if (!parsed.date) {
                parsed.date = typeof selectedDate !== 'undefined' ? selectedDate : '';
            }

            // 如果没有 dayOfWeek，自动计算
            if (!parsed.dayOfWeek && parsed.date) {
                parsed.dayOfWeek = getDayOfWeek(parsed.date);
            }

            return parsed;
        } catch (err) {
            console.error('JSON 解析错误:', err, '\n原始内容:', jsonStr);
            if (typeof showNotification === 'function') {
                showNotification('AI 返回内容格式异常，请重试', 'error');
            }
            return null;
        }
    }

    function getDayOfWeek(dateStr) {
        try {
            var parts = dateStr.split('-');
            var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            var days = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
            return days[d.getDay()];
        } catch (e) {
            return '';
        }
    }

    // ==================== AI 预览弹窗 ====================
    function showAiPreview(parsedData) {
        if (!parsedData) return;
        aiParsedTasks = parsedData;

        // 日期
        var dateEl = document.getElementById('aiPreviewDate');
        if (dateEl) {
            dateEl.textContent = (parsedData.date || '') + ' ' + (parsedData.dayOfWeek || '');
        }

        // 总时长
        var totalMinutes = 0;
        parsedData.subjects.forEach(function(s) {
            s.tasks.forEach(function(t) {
                totalMinutes += t.estimatedMinutes || 15;
            });
        });

        var totalTimeEl = document.getElementById('aiPreviewTotalTime');
        if (totalTimeEl) {
            totalTimeEl.textContent = '约 ' + totalMinutes + ' 分钟';
        }

        // 学科分组
        var container = document.getElementById('aiPreviewSubjects');
        if (!container) return;

        var subjectColors = typeof SUBJECT_COLORS !== 'undefined' ? SUBJECT_COLORS : {};

        container.innerHTML = parsedData.subjects.map(function(subject) {
            var subjectTotal = subject.tasks.reduce(function(sum, t) {
                return sum + (t.estimatedMinutes || 15);
            }, 0);
            var color = subjectColors[subject.name] || '#8B5CF6';
            return '<div class="bg-gray-50 rounded-lg p-3">' +
                '<div class="flex items-center justify-between mb-2">' +
                    '<div class="flex items-center">' +
                        '<div class="w-3 h-3 rounded-full mr-2" style="background-color:' + color + '"></div>' +
                        '<span class="font-medium text-sm">' + escapeHtml(subject.name) + '</span>' +
                    '</div>' +
                    '<span class="text-xs text-textSecondary">合计约 ' + subjectTotal + ' 分钟</span>' +
                '</div>' +
                '<div class="space-y-1.5">' +
                    subject.tasks.map(function(task) {
                        return '<div class="flex items-center justify-between text-sm pl-5">' +
                            '<span class="text-textPrimary">' + escapeHtml(task.title) + '</span>' +
                            '<span class="text-xs text-purple-500 ml-2 whitespace-nowrap">约 ' + (task.estimatedMinutes || 15) + ' 分钟</span>' +
                        '</div>';
                    }).join('') +
                '</div>' +
            '</div>';
        }).join('');

        // 显示弹窗
        var modal = document.getElementById('aiPreviewModal');
        if (modal) modal.classList.remove('hidden');
    }

    function hideAiPreview() {
        var modal = document.getElementById('aiPreviewModal');
        if (modal) modal.classList.add('hidden');
        aiParsedTasks = null;
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ==================== 任务创建 ====================
    function createTasksFromAiResult(parsedData) {
        if (!parsedData || !parsedData.subjects) return;

        var targetDate = parsedData.date || (typeof selectedDate !== 'undefined' ? selectedDate : '');
        var createdCount = 0;
        var skippedCount = 0;
        var now = Date.now();

        parsedData.subjects.forEach(function(subject) {
            subject.tasks.forEach(function(taskInfo) {
                // 检测重复：同日期 + 同学科 + 同名
                var isDuplicate = false;
                if (typeof tasks !== 'undefined' && Array.isArray(tasks)) {
                    isDuplicate = tasks.some(function(t) {
                        return t.date === targetDate &&
                            t.subject === subject.name &&
                            t.name === taskInfo.title;
                    });
                }

                if (isDuplicate) {
                    skippedCount++;
                    return;
                }

                var newTask = {
                    id: now + Math.floor(Math.random() * 100000) + createdCount,
                    name: taskInfo.title,
                    subject: subject.name,
                    description: 'AI 智能整理 - ' + subject.name + '作业',
                    plannedDuration: taskInfo.estimatedMinutes || 15,
                    actualDuration: 0,
                    date: targetDate,
                    startDate: null,
                    endDate: null,
                    coins: Math.max(1, Math.ceil((taskInfo.estimatedMinutes || 15) / 15)),
                    status: 'pending',
                    frequency: 'once',
                    seriesId: null,
                    aiEstimated: true
                };

                if (typeof tasks !== 'undefined' && Array.isArray(tasks)) {
                    tasks.push(newTask);
                }
                createdCount++;
            });
        });

        // 保存并刷新
        if (typeof saveData === 'function') saveData();
        if (typeof renderTaskList === 'function') renderTaskList();
        if (typeof updateStatistics === 'function') updateStatistics();
        if (typeof renderCalendar === 'function') renderCalendar();
        updateAiTimeEstimate();

        if (typeof showNotification === 'function') {
            var msg = '已添加 ' + createdCount + ' 个作业任务';
            if (skippedCount > 0) {
                msg += '，跳过 ' + skippedCount + ' 个重复任务';
            }
            showNotification(msg, 'success');
        }

        // 如果 AI 返回的日期与当前选中日期不同，切换到该日期
        if (targetDate && typeof selectedDate !== 'undefined' && targetDate !== selectedDate) {
            selectedDate = targetDate;
            if (typeof renderCalendar === 'function') renderCalendar();
            if (typeof renderTaskList === 'function') renderTaskList();
        }

        // 更新日期导航显示
        updateDateNavDisplay();
    }

    // ==================== 时间估算展示 ====================
    function updateAiTimeEstimate() {
        var dayTasks = [];
        if (typeof tasks !== 'undefined' && Array.isArray(tasks)) {
            var date = typeof selectedDate !== 'undefined' ? selectedDate : '';
            dayTasks = tasks.filter(function(t) {
                return t.date === date;
            });
        }

        var totalMinutes = dayTasks.reduce(function(sum, t) {
            return sum + (t.plannedDuration || 0);
        }, 0);

        // 更新总时长横幅
        var banner = document.getElementById('aiTotalTimeBanner');
        var totalValue = document.getElementById('aiTotalTimeValue');
        if (banner && totalValue && dayTasks.length > 0) {
            banner.classList.remove('hidden');
            totalValue.textContent = '约 ' + totalMinutes + ' 分钟';
        } else if (banner && dayTasks.length === 0) {
            banner.classList.add('hidden');
        }

        // 更新每个学科分组的合计时间
        setTimeout(function() {
            var subjectGroups = document.querySelectorAll('#taskList > div.mb-4');
            subjectGroups.forEach(function(group) {
                var header = group.querySelector('.flex.items-center.mb-2');
                if (!header) return;

                var h3 = header.querySelector('h3');
                if (!h3) return;
                var subjectName = h3.textContent.trim();

                var subjectTasks = dayTasks.filter(function(t) {
                    return t.subject === subjectName;
                });
                var subjectTotal = subjectTasks.reduce(function(sum, t) {
                    return sum + (t.plannedDuration || 0);
                }, 0);

                // 添加/更新合计时间
                var subtotalSpan = header.querySelector('.ai-subject-subtotal');
                if (!subtotalSpan && subjectTotal > 0) {
                    subtotalSpan = document.createElement('span');
                    subtotalSpan.className = 'ai-subject-subtotal ml-2 text-xs text-purple-500 font-normal';
                    header.appendChild(subtotalSpan);
                }
                if (subtotalSpan) {
                    subtotalSpan.textContent = '合计约 ' + subjectTotal + ' 分钟';
                }
            });
        }, 100);
    }

    // ==================== 日期导航 ====================
    function getSelectedDate() {
        return typeof selectedDate !== 'undefined' ? selectedDate : '';
    }

    function setSelectedDate(dateStr) {
        selectedDate = dateStr;
    }

    function updateDateNavDisplay() {
        var dayNavDate = document.getElementById('dayNavDate');
        if (!dayNavDate) return;

        var dateStr = getSelectedDate();
        if (!dateStr) return;

        try {
            var parts = dateStr.split('-');
            var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            var weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
            dayNavDate.textContent = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + weekDays[d.getDay()];
        } catch (e) {
            dayNavDate.textContent = dateStr;
        }
    }

    function navigateDay(offset) {
        var dateStr = getSelectedDate();
        if (!dateStr) return;

        try {
            var parts = dateStr.split('-');
            var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            d.setDate(d.getDate() + offset);
            var newDate = d.getFullYear() + '-' +
                String(d.getMonth() + 1).padStart(2, '0') + '-' +
                String(d.getDate()).padStart(2, '0');
            setSelectedDate(newDate);
        } catch (e) {
            return;
        }

        // 刷新所有视图
        if (typeof renderTaskList === 'function') renderTaskList();
        if (typeof updateStatistics === 'function') updateStatistics();
        if (typeof renderCalendar === 'function') renderCalendar();
        updateAiTimeEstimate();
        updateDateNavDisplay();
    }

    // ==================== AI 处理主流程 ====================
    function handleAiProcess() {
        var textInput = document.getElementById('aiTextInput');
        var text = textInput ? textInput.value.trim() : '';

        if (!text && aiOcrResults.length === 0) {
            if (typeof showNotification === 'function') {
                showNotification('请先输入作业内容或上传图片进行识别', 'warning');
            }
            return;
        }

        if (!aiSettings.apiKey) {
            if (typeof showNotification === 'function') {
                showNotification('请先在"我的"页面配置 AI API Key', 'warning');
            }
            return;
        }

        var inputText = text || aiOcrResults.join('\n');
        if (!inputText.trim()) {
            if (typeof showNotification === 'function') {
                showNotification('请输入有效的作业内容', 'warning');
            }
            return;
        }

        // 显示加载动画
        var spinner = document.getElementById('aiProcessingSpinner');
        var processBtn = document.getElementById('aiProcessBtn');
        if (spinner) spinner.classList.remove('hidden');
        if (processBtn) processBtn.disabled = true;

        callLLM(inputText).then(function(result) {
            if (spinner) spinner.classList.add('hidden');
            if (processBtn) processBtn.disabled = false;

            if (result) {
                showAiPreview(result);
            }
        });
    }

    // ==================== AI 设置 UI ====================
    function updateAiSettingsUI() {
        var providerEl = document.getElementById('aiProvider');
        var baseUrlEl = document.getElementById('aiBaseUrl');
        var apiKeyEl = document.getElementById('aiApiKey');
        var modelEl = document.getElementById('aiModel');

        if (providerEl) providerEl.value = aiSettings.provider;
        if (baseUrlEl) baseUrlEl.value = aiSettings.baseUrl || '';
        if (apiKeyEl) apiKeyEl.value = aiSettings.apiKey || '';
        if (modelEl) modelEl.value = aiSettings.model || '';
    }

    function openAiSettings() {
        updateAiSettingsUI();
        var modal = document.getElementById('aiSettingsModal');
        if (modal) modal.classList.remove('hidden');
    }

    function closeAiSettings() {
        var modal = document.getElementById('aiSettingsModal');
        if (modal) modal.classList.add('hidden');
    }

    function saveAiSettingsFromUI() {
        var providerEl = document.getElementById('aiProvider');
        var baseUrlEl = document.getElementById('aiBaseUrl');
        var apiKeyEl = document.getElementById('aiApiKey');
        var modelEl = document.getElementById('aiModel');

        aiSettings.provider = providerEl ? providerEl.value : 'anthropic';
        aiSettings.baseUrl = baseUrlEl ? baseUrlEl.value.trim() : '';
        aiSettings.apiKey = apiKeyEl ? apiKeyEl.value.trim() : '';
        aiSettings.model = modelEl ? modelEl.value.trim() : '';

        if (!aiSettings.apiKey) {
            if (typeof showNotification === 'function') {
                showNotification('API Key 不能为空', 'warning');
            }
            return;
        }

        saveAiSettings();
        if (typeof showNotification === 'function') {
            showNotification('AI 设置已保存', 'success');
        }
        closeAiSettings();
    }

    function initAiSettingsModalEvents() {
        var closeBtn = document.getElementById('closeAiSettingsBtn');
        var cancelBtn = document.getElementById('aiSettingsCancelBtn');
        var saveBtn = document.getElementById('aiSettingsSaveBtn');
        var modal = document.getElementById('aiSettingsModal');
        var providerEl = document.getElementById('aiProvider');

        if (closeBtn) closeBtn.addEventListener('click', closeAiSettings);
        if (cancelBtn) cancelBtn.addEventListener('click', closeAiSettings);
        if (saveBtn) saveBtn.addEventListener('click', saveAiSettingsFromUI);

        // 点击背景关闭
        if (modal) {
            modal.addEventListener('click', function(e) {
                if (e.target === modal) closeAiSettings();
            });
        }

        // 切换服务商时自动更新 baseUrl 和 model
        if (providerEl) {
            providerEl.addEventListener('change', function() {
                var baseUrlEl = document.getElementById('aiBaseUrl');
                var modelEl = document.getElementById('aiModel');
                if (this.value === 'deepseek') {
                    if (baseUrlEl) baseUrlEl.value = 'https://api.deepseek.com';
                    if (modelEl) modelEl.value = 'deepseek-chat';
                } else if (this.value === 'anthropic') {
                    if (baseUrlEl) baseUrlEl.value = 'https://api.anthropic.com';
                    if (modelEl) modelEl.value = 'claude-3-haiku-20240307';
                } else {
                    if (baseUrlEl) baseUrlEl.value = 'https://api.openai.com/v1';
                    if (modelEl) modelEl.value = 'gpt-3.5-turbo';
                }
            });
        }
    }

    // ==================== 事件绑定 ====================
    function initAiInput() {
        // 加载设置
        loadAiSettings();

        // AI 输入区折叠/展开
        var toggleBtn = document.getElementById('aiToggleBtn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', toggleAiInput);
        }

        // 模式切换
        var tabText = document.getElementById('aiTabText');
        var tabImage = document.getElementById('aiTabImage');
        if (tabText) tabText.addEventListener('click', function() { switchAiMode('text'); });
        if (tabImage) tabImage.addEventListener('click', function() { switchAiMode('image'); });

        // 清空按钮
        var clearBtn = document.getElementById('aiClearBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', function() {
                var textarea = document.getElementById('aiTextInput');
                if (textarea) textarea.value = '';
                aiImages = [];
                aiOcrResults = [];
                renderImagePreviews();
            });
        }

        // 智能整理按钮
        var processBtn = document.getElementById('aiProcessBtn');
        if (processBtn) {
            processBtn.addEventListener('click', handleAiProcess);
        }

        // 图片上传 - 拖拽
        var dropZone = document.getElementById('imageDropZone');
        var fileInput = document.getElementById('aiImageInput');
        if (dropZone && fileInput) {
            dropZone.addEventListener('click', function() { fileInput.click(); });

            dropZone.addEventListener('dragover', function(e) {
                e.preventDefault();
                dropZone.classList.add('border-purple-400', 'bg-purple-50');
            });

            dropZone.addEventListener('dragleave', function() {
                dropZone.classList.remove('border-purple-400', 'bg-purple-50');
            });

            dropZone.addEventListener('drop', function(e) {
                e.preventDefault();
                dropZone.classList.remove('border-purple-400', 'bg-purple-50');
                handleImageFiles(e.dataTransfer.files);
            });

            fileInput.addEventListener('change', function() {
                handleImageFiles(this.files);
                this.value = '';
            });
        }

        // OCR 按钮
        var ocrBtn = document.getElementById('aiOcrBtn');
        if (ocrBtn) {
            ocrBtn.addEventListener('click', performOCR);
        }

        // AI 预览弹窗
        var closePreviewBtn = document.getElementById('closeAiPreviewBtn');
        var previewCancelBtn = document.getElementById('aiPreviewCancelBtn');
        var previewConfirmBtn = document.getElementById('aiPreviewConfirmBtn');
        var previewModal = document.getElementById('aiPreviewModal');

        if (closePreviewBtn) closePreviewBtn.addEventListener('click', hideAiPreview);
        if (previewCancelBtn) previewCancelBtn.addEventListener('click', hideAiPreview);
        if (previewConfirmBtn) {
            previewConfirmBtn.addEventListener('click', function() {
                if (aiParsedTasks) {
                    createTasksFromAiResult(aiParsedTasks);
                    hideAiPreview();
                    // 折叠输入区
                    var body = document.getElementById('aiInputBody');
                    var icon = document.getElementById('aiToggleIcon');
                    if (body) body.classList.add('hidden');
                    if (icon) icon.style.transform = 'rotate(0deg)';
                }
            });
        }
        if (previewModal) {
            previewModal.addEventListener('click', function(e) {
                if (e.target === previewModal) hideAiPreview();
            });
        }

        // AI 设置入口按钮
        var settingsEntryBtn = document.getElementById('aiSettingsEntryBtn');
        if (settingsEntryBtn) {
            settingsEntryBtn.addEventListener('click', openAiSettings);
        }
        initAiSettingsModalEvents();

        // 日期导航
        var prevDayBtn = document.getElementById('prevDayBtn');
        var nextDayBtn = document.getElementById('nextDayBtn');
        if (prevDayBtn) prevDayBtn.addEventListener('click', function() { navigateDay(-1); });
        if (nextDayBtn) nextDayBtn.addEventListener('click', function() { navigateDay(1); });
        updateDateNavDisplay();

        // Monkey-patch renderTaskList 以便每次渲染后更新时间估算
        if (typeof renderTaskList === 'function') {
            var origRenderTaskList = renderTaskList;
            renderTaskList = function(filter) {
                origRenderTaskList(filter);
                updateAiTimeEstimate();
            };
        }

        // Monkey-patch renderCalendar 以便更新日期导航显示
        if (typeof renderCalendar === 'function') {
            var origRenderCalendar = renderCalendar;
            renderCalendar = function() {
                origRenderCalendar.apply(this, arguments);
                updateDateNavDisplay();
            };
        }
    }

    // ==================== 初始化 ====================
    // 挂载到现有应用的初始化链
    function hookIntoInit() {
        // 多个尝试方式，确保能挂载成功
        var initFn = null;
        if (typeof enhancedInitAppWithTaskSettings === 'function') {
            initFn = enhancedInitAppWithTaskSettings;
        } else if (typeof enhancedInitAppWithLogs === 'function') {
            initFn = enhancedInitAppWithLogs;
        } else if (typeof enhancedInitApp === 'function') {
            initFn = enhancedInitApp;
        } else if (typeof initApp === 'function') {
            initFn = initApp;
        }

        if (initFn) {
            var origInit = initFn;
            // 用 window 上的引用替换
            var fnName = '';
            if (typeof enhancedInitAppWithTaskSettings === 'function') fnName = 'enhancedInitAppWithTaskSettings';
            else if (typeof enhancedInitAppWithLogs === 'function') fnName = 'enhancedInitAppWithLogs';
            else if (typeof enhancedInitApp === 'function') fnName = 'enhancedInitApp';
            else if (typeof initApp === 'function') fnName = 'initApp';

            if (fnName) {
                window[fnName] = function() {
                    origInit.apply(this, arguments);
                    setTimeout(initAiInput, 200);
                };
            }
        }

        // 同时监听 DOMContentLoaded 确保一定执行
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(initAiInput, 300);
        });
    }

    // 立即尝试挂载
    hookIntoInit();

    // 如果 DOM 已经加载完成，直接初始化
    if (document.readyState === 'interactive' || document.readyState === 'complete') {
        setTimeout(initAiInput, 200);
    }

})();
