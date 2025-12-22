document.addEventListener('DOMContentLoaded', () => {
    console.log('Spreadsheet input initialized');
    console.log('Handsontable available:', typeof Handsontable !== 'undefined');

    const nodesContainer = document.getElementById('spreadsheet-nodes');
    const membersContainer = document.getElementById('spreadsheet-members');
    const nodeLoadsContainer = document.getElementById('spreadsheet-node-loads');
    const memberLoadsContainer = document.getElementById('spreadsheet-member-loads');
    const tabs = document.querySelectorAll('.tab');

    let nodesSheet = null;
    let membersSheet = null;
    let nodeLoadsSheet = null;
    let memberLoadsSheet = null;
    let activeSheetType = 'nodes';

    const safeVal = (v) => (v === undefined || v === null || v === '') ? '' : v;

    let initialNodes = [];
    let initialMembers = [];
    let initialNodeLoads = [];
    let initialMemberLoads = [];

    if (window.opener && window.opener.getSpreadsheetData) {
        try {
            const data = window.opener.getSpreadsheetData();
            initialNodes = data.nodes || [];
            initialMembers = data.members || [];
            initialNodeLoads = data.nodeLoads || [];
            initialMemberLoads = data.memberLoads || [];
            console.log('Data loaded from opener:', data);
        } catch (e) {
            console.error('Error getting data from opener:', e);
        }
    } else {
        console.log('Using dummy data for testing');
        initialNodes = [{x:0, y:0, fix:'Free'}, {x:5, y:0, fix:'Pin'}];
        initialMembers = [{node1:1, node2:2, E:205000, A:50, I:2000, conn1:'Rigid', conn2:'Rigid'}];
        initialNodeLoads = [{node:1, px:10, py:-5, mz:0}];
        initialMemberLoads = [{member:1, w:-2}];
    }

    const nodesData = initialNodes.map(n => {
        let fixDisplay = safeVal(n.fix) || 'Free';
        if (fixDisplay.toLowerCase() === 'free') fixDisplay = 'Free';
        else if (fixDisplay.toLowerCase() === 'pinned') fixDisplay = 'Pin';
        else if (fixDisplay.toLowerCase() === 'fixed') fixDisplay = 'Fixed';
        else if (fixDisplay.toLowerCase() === 'roller_x_fixed') fixDisplay = 'RollerX';
        else if (fixDisplay.toLowerCase() === 'roller_y_fixed') fixDisplay = 'RollerY';

        return [
            safeVal(n.x), safeVal(n.y), fixDisplay, safeVal(n.dx), safeVal(n.dy), safeVal(n.rot)
        ];
    });
    while(nodesData.length < 50) nodesData.push(['', '', 'Free', '', '', '']);

    const normalizeConnDisplay = (value) => {
        const raw = safeVal(value) || 'Rigid';
        const v = String(raw).trim().toLowerCase();
        if (v === 'pinned' || v === 'pin') return 'Pin';
        if (v === 'spring') return 'Spring';
        return 'Rigid';
    };

    const membersData = initialMembers.map(m => {
        const conn1Display = normalizeConnDisplay(m.conn1);
        const conn2Display = normalizeConnDisplay(m.conn2);

        // 旧キー(spring_*_Kx) との互換を維持しつつ、新キー(Kx_tension/compression, rigidT/C)に対応
        const iKxT = safeVal(m.spring_i_Kx_tension !== undefined ? m.spring_i_Kx_tension : m.spring_i_Kx);
        const iKxC = safeVal(m.spring_i_Kx_compression !== undefined ? m.spring_i_Kx_compression : m.spring_i_Kx);
        const iRigidT = !!(m.spring_i_rigidKx_tension ?? m.spring_i_rigidKxT ?? false);
        const iRigidC = !!(m.spring_i_rigidKx_compression ?? m.spring_i_rigidKxC ?? false);

        const jKxT = safeVal(m.spring_j_Kx_tension !== undefined ? m.spring_j_Kx_tension : m.spring_j_Kx);
        const jKxC = safeVal(m.spring_j_Kx_compression !== undefined ? m.spring_j_Kx_compression : m.spring_j_Kx);
        const jRigidT = !!(m.spring_j_rigidKx_tension ?? m.spring_j_rigidKxT ?? false);
        const jRigidC = !!(m.spring_j_rigidKx_compression ?? m.spring_j_rigidKxC ?? false);

        return [
            safeVal(m.node1), safeVal(m.node2),
            safeVal(m.E), safeVal(m.F),
            safeVal(m.I), safeVal(m.A), safeVal(m.Z), safeVal(m.i),
            safeVal(m.J), safeVal(m.Iw),
            safeVal(m.K), safeVal(m.density),
            safeVal(m.name), safeVal(m.axis),
            conn1Display, conn2Display,
            // i端バネ
            iKxT, iKxC, iRigidT, iRigidC, safeVal(m.spring_i_Ky), safeVal(m.spring_i_Kr),
            // j端バネ
            jKxT, jKxC, jRigidT, jRigidC, safeVal(m.spring_j_Ky), safeVal(m.spring_j_Kr)
        ];
    });
    // columns: 0-13(14列)は部材情報、14-15が接合、16-27がバネ
    while(membersData.length < 50) membersData.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', 'Rigid', 'Rigid', '', '', false, false, '', '', '', '', false, false, '', '']);

    const nodeLoadsData = initialNodeLoads.map(l => [
        safeVal(l.node), safeVal(l.px), safeVal(l.py), safeVal(l.mz)
    ]);
    while(nodeLoadsData.length < 50) nodeLoadsData.push(['', '', '', '']);

    const memberLoadsData = initialMemberLoads.map(l => [
        safeVal(l.member), safeVal(l.w)
    ]);
    while(memberLoadsData.length < 50) memberLoadsData.push(['', '']);

    function initNodesSheet() {
        if (nodesSheet) return;
        try {
            nodesSheet = new Handsontable(nodesContainer, {
                data: nodesData,
                colHeaders: ['X (m)', 'Y (m)', '境界条件', '強制変位X', '強制変位Y', '強制回転'],
                columns: [
                    { type: 'text' },
                    { type: 'text' },
                    { type: 'dropdown', source: ['Free', 'Pin', 'Fixed', 'RollerX', 'RollerY'] },
                    { type: 'text' },
                    { type: 'text' },
                    { type: 'text' },
                ],
                colWidths: [80, 80, 100, 90, 90, 90],
                rowHeaders: true,
                width: '100%',
                height: 'calc(100vh - 250px)',
                licenseKey: 'non-commercial-and-evaluation',
                contextMenu: true,
                manualRowMove: true,
                manualColumnMove: false,
                minSpareRows: 1,
            });
        } catch (e) {
            console.error('Error initializing nodes sheet:', e);
        }
    }

    function initMembersSheet() {
        if (membersSheet) return;
        try {
            membersSheet = new Handsontable(membersContainer, {
                data: membersData,
                colHeaders: [
                    '始点No', '終点No', 'E (N/mm²)', 'F (N/mm²)', 'I (cm⁴)', 'A (cm²)', 'Z (cm³)', 'i (cm)',
                    'J (cm⁴)', 'Iw (cm⁶)', 'K', '密度 (kg/m³)', '断面名称', '軸方向',
                    '始端接合', '終端接合',
                    '始端Kx 引張 (kN/mm)', '始端Kx 圧縮 (kN/mm)', '始端Kx 剛T', '始端Kx 剛C', '始端Ky (kN/mm)', '始端Kr (kNmm/rad)',
                    '終端Kx 引張 (kN/mm)', '終端Kx 圧縮 (kN/mm)', '終端Kx 剛T', '終端Kx 剛C', '終端Ky (kN/mm)', '終端Kr (kNmm/rad)'
                ],
                columns: [
                    { type: 'text' },
                    { type: 'text' },
                    { type: 'text' },
                    { type: 'text' },
                    { type: 'text' },
                    { type: 'text' },
                    { type: 'text' },
                    { type: 'text' },
                    { type: 'text' },
                    { type: 'text' },
                    { type: 'text' },
                    { type: 'text' },
                    { type: 'text' },
                    { type: 'text' },
                    { type: 'dropdown', source: ['Rigid', 'Pin', 'Spring'] },
                    { type: 'dropdown', source: ['Rigid', 'Pin', 'Spring'] },
                    { type: 'text' },
                    { type: 'text' },
                    { type: 'checkbox' },
                    { type: 'checkbox' },
                    { type: 'text' },
                    { type: 'text' },
                    { type: 'text' },
                    { type: 'text' },
                    { type: 'checkbox' },
                    { type: 'checkbox' },
                    { type: 'text' },
                    { type: 'text' },
                ],
                colWidths: [
                    60, 60, 80, 80, 80, 80, 80, 60,
                    80, 90, 50, 80, 100, 60,
                    80, 80,
                    120, 120, 70, 70, 100, 110,
                    120, 120, 70, 70, 100, 110
                ],
                rowHeaders: true,
                width: '100%',
                height: 'calc(100vh - 250px)',
                licenseKey: 'non-commercial-and-evaluation',
                contextMenu: true,
                manualRowMove: true,
                manualColumnMove: false,
                minSpareRows: 1,
            });
        } catch (e) {
            console.error('Error initializing members sheet:', e);
        }
    }

    function initNodeLoadsSheet() {
        if (nodeLoadsSheet) return;
        try {
            nodeLoadsSheet = new Handsontable(nodeLoadsContainer, {
                data: nodeLoadsData,
                colHeaders: ['節点No', 'Px (kN)', 'Py (kN)', 'Mz (kNm)'],
                columns: [
                    { type: 'text' },
                    { type: 'text' },
                    { type: 'text' },
                    { type: 'text' },
                ],
                colWidths: [80, 100, 100, 100],
                rowHeaders: true,
                width: '100%',
                height: 'calc(100vh - 250px)',
                licenseKey: 'non-commercial-and-evaluation',
                contextMenu: true,
                manualRowMove: true,
                manualColumnMove: false,
                minSpareRows: 1,
            });
        } catch (e) {
            console.error('Error initializing node loads sheet:', e);
        }
    }

    function initMemberLoadsSheet() {
        if (memberLoadsSheet) return;
        try {
            memberLoadsSheet = new Handsontable(memberLoadsContainer, {
                data: memberLoadsData,
                colHeaders: ['部材No', 'w (kN/m)'],
                columns: [
                    { type: 'text' },
                    { type: 'text' },
                ],
                colWidths: [80, 120],
                rowHeaders: true,
                width: '100%',
                height: 'calc(100vh - 250px)',
                licenseKey: 'non-commercial-and-evaluation',
                contextMenu: true,
                manualRowMove: true,
                manualColumnMove: false,
                minSpareRows: 1,
            });
        } catch (e) {
            console.error('Error initializing member loads sheet:', e);
        }
    }

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const target = tab.dataset.target;
            activeSheetType = target;

            nodesContainer.style.display = 'none';
            membersContainer.style.display = 'none';
            nodeLoadsContainer.style.display = 'none';
            memberLoadsContainer.style.display = 'none';

            if (target === 'nodes') {
                nodesContainer.style.display = 'block';
                initNodesSheet();
                if (nodesSheet) nodesSheet.render();
            }
            else if (target === 'members') {
                membersContainer.style.display = 'block';
                initMembersSheet();
                if (membersSheet) membersSheet.render();
            }
            else if (target === 'node-loads') {
                nodeLoadsContainer.style.display = 'block';
                initNodeLoadsSheet();
                if (nodeLoadsSheet) nodeLoadsSheet.render();
            }
            else if (target === 'member-loads') {
                memberLoadsContainer.style.display = 'block';
                initMemberLoadsSheet();
                if (memberLoadsSheet) memberLoadsSheet.render();
            }
        });
    });

    document.getElementById('add-row-btn').addEventListener('click', () => {
        try {
            if (activeSheetType === 'nodes' && nodesSheet) {
                nodesSheet.alter('insert_row', nodesSheet.countRows());
            }
            else if (activeSheetType === 'members' && membersSheet) {
                membersSheet.alter('insert_row', membersSheet.countRows());
            }
            else if (activeSheetType === 'node-loads' && nodeLoadsSheet) {
                nodeLoadsSheet.alter('insert_row', nodeLoadsSheet.countRows());
            }
            else if (activeSheetType === 'member-loads' && memberLoadsSheet) {
                memberLoadsSheet.alter('insert_row', memberLoadsSheet.countRows());
            }
        } catch (e) {
            console.error('Error adding row:', e);
        }
    });

    document.getElementById('delete-row-btn').addEventListener('click', () => {
        try {
            const deleteSelectedRow = (sheet) => {
                const selected = sheet.getSelected();
                if (selected && selected.length > 0) {
                    const row = selected[0][0];
                    sheet.alter('remove_row', row);
                    return;
                }
                alert('削除する行を選択してください');
            };

            if (activeSheetType === 'nodes' && nodesSheet) deleteSelectedRow(nodesSheet);
            else if (activeSheetType === 'members' && membersSheet) deleteSelectedRow(membersSheet);
            else if (activeSheetType === 'node-loads' && nodeLoadsSheet) deleteSelectedRow(nodeLoadsSheet);
            else if (activeSheetType === 'member-loads' && memberLoadsSheet) deleteSelectedRow(memberLoadsSheet);
        } catch (e) {
            console.error('Error deleting row:', e);
        }
    });

    document.getElementById('close-btn').addEventListener('click', () => {
        window.close();
    });

    document.getElementById('reflect-btn').addEventListener('click', () => {
        try {
            if (!nodesSheet) { nodesContainer.style.display = 'block'; initNodesSheet(); nodesContainer.style.display = 'none'; }
            if (!membersSheet) { membersContainer.style.display = 'block'; initMembersSheet(); membersContainer.style.display = 'none'; }
            if (!nodeLoadsSheet) { nodeLoadsContainer.style.display = 'block'; initNodeLoadsSheet(); nodeLoadsContainer.style.display = 'none'; }
            if (!memberLoadsSheet) { memberLoadsContainer.style.display = 'block'; initMemberLoadsSheet(); memberLoadsContainer.style.display = 'none'; }

            if (activeSheetType === 'nodes') nodesContainer.style.display = 'block';
            else if (activeSheetType === 'members') membersContainer.style.display = 'block';
            else if (activeSheetType === 'node-loads') nodeLoadsContainer.style.display = 'block';
            else if (activeSheetType === 'member-loads') memberLoadsContainer.style.display = 'block';

            const nData = nodesSheet.getData();
            const mData = membersSheet.getData();
            const nlData = nodeLoadsSheet.getData();
            const mlData = memberLoadsSheet.getData();

            const nodes = [];
            nData.forEach(row => {
                const x = row[0];
                const y = row[1];
                if ((x === '' || x === null) && (y === '' || y === null)) return;

                let fixValue = row[2] || 'Free';
                if (fixValue === 'Pin') fixValue = 'Pinned';
                else if (fixValue === 'RollerX') fixValue = 'RollerX';
                else if (fixValue === 'RollerY') fixValue = 'RollerY';

                nodes.push({ x: x, y: y, fix: fixValue, dx: row[3], dy: row[4], rot: row[5] });
            });

            const members = [];
            mData.forEach(row => {
                const n1 = row[0];
                const n2 = row[1];
                if ((n1 === '' || n1 === null) && (n2 === '' || n2 === null)) return;

                // 列順: 0:n1 1:n2 2:E 3:F 4:I 5:A 6:Z 7:i 8:J 9:Iw 10:K 11:density 12:name 13:axis 14:conn1 15:conn2 16-27:springs
                const normalizeConnForParent = (conn) => {
                    const v = String(conn || '').trim().toLowerCase();
                    if (v === 'pin' || v === 'pinned') return 'Pinned';
                    if (v === 'spring') return 'Spring';
                    return 'Rigid';
                };
                const conn1 = normalizeConnForParent(row[14] || 'Rigid');
                const conn2 = normalizeConnForParent(row[15] || 'Rigid');

                const iKxT = row[16];
                const iKxC = (row[17] !== undefined && row[17] !== null && row[17] !== '') ? row[17] : row[16];
                const iRigidT = !!row[18];
                const iRigidC = !!row[19];
                const iKy = row[20];
                const iKr = row[21];

                const jKxT = row[22];
                const jKxC = (row[23] !== undefined && row[23] !== null && row[23] !== '') ? row[23] : row[22];
                const jRigidT = !!row[24];
                const jRigidC = !!row[25];
                const jKy = row[26];
                const jKr = row[27];

                members.push({
                    node1: n1, node2: n2,
                    E: row[2], F: row[3],
                    I: row[4], A: row[5], Z: row[6], i: row[7],
                    J: row[8], Iw: row[9],
                    K: row[10], density: row[11],
                    name: row[12], axis: row[13],
                    conn1: conn1, conn2: conn2,
                    // legacy keys（3D側互換）
                    spring_i_Kx: iKxT,
                    spring_i_Ky: iKy,
                    spring_i_Kr: iKr,
                    spring_j_Kx: jKxT,
                    spring_j_Ky: jKy,
                    spring_j_Kr: jKr,

                    // 新キー（2D側で使用）
                    spring_i_Kx_tension: iKxT,
                    spring_i_Kx_compression: iKxC,
                    spring_i_rigidKx_tension: iRigidT,
                    spring_i_rigidKx_compression: iRigidC,
                    spring_j_Kx_tension: jKxT,
                    spring_j_Kx_compression: jKxC,
                    spring_j_rigidKx_tension: jRigidT,
                    spring_j_rigidKx_compression: jRigidC
                });
            });

            const nodeLoads = [];
            nlData.forEach(row => {
                const node = row[0];
                if (node === '' || node === null) return;
                nodeLoads.push({ node: node, px: row[1], py: row[2], mz: row[3] });
            });

            const memberLoads = [];
            mlData.forEach(row => {
                const member = row[0];
                if (member === '' || member === null) return;
                memberLoads.push({ member: member, w: row[1] });
            });

            if (nodes.length === 0 && members.length === 0) {
                if (!confirm('データが空です。解析モデルをクリアしますか?')) {
                    return;
                }
            }

            if (window.opener && window.opener.updateFromSpreadsheet) {
                window.opener.updateFromSpreadsheet({ nodes, members, nodeLoads, memberLoads });
                alert('データを反映しました!');
            } else {
                alert('親ウィンドウが見つかりません。');
            }
        } catch (e) {
            console.error('Error in reflect logic:', e);
            alert('エラーが発生しました: ' + e.message);
        }
    });
});
