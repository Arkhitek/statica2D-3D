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

    const membersData = initialMembers.map(m => {
        let conn1Display = safeVal(m.conn1) || 'Rigid';
        let conn2Display = safeVal(m.conn2) || 'Rigid';

        conn1Display = conn1Display.charAt(0).toUpperCase() + conn1Display.slice(1).toLowerCase();
        conn2Display = conn2Display.charAt(0).toUpperCase() + conn2Display.slice(1).toLowerCase();

        if (conn1Display === 'Pinned') conn1Display = 'Pin';
        if (conn2Display === 'Pinned') conn2Display = 'Pin';

        return [
            safeVal(m.node1), safeVal(m.node2),
            safeVal(m.E), safeVal(m.F),
            safeVal(m.I), safeVal(m.A), safeVal(m.Z), safeVal(m.i),
            safeVal(m.K), safeVal(m.density),
            safeVal(m.name), safeVal(m.axis),
            conn1Display, conn2Display,
            safeVal(m.spring_i_Kx), safeVal(m.spring_i_Ky), safeVal(m.spring_i_Kr),
            safeVal(m.spring_j_Kx), safeVal(m.spring_j_Ky), safeVal(m.spring_j_Kr)
        ];
    });
    while(membersData.length < 50) membersData.push(['', '', '', '', '', '', '', '', '', '', '', '', 'Rigid', 'Rigid', '', '', '', '', '', '']);

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
                colHeaders: ['始点No', '終点No', 'E (N/mm²)', 'F (N/mm²)', 'I (cm⁴)', 'A (cm²)', 'Z (cm³)', 'i (cm)', 'K', '密度 (kg/m³)', '断面名称', '軸方向', '始端接合', '終端接合', '始端Kx (kN/mm)', '始端Ky (kN/mm)', '始端Kr (kNmm/rad)', '終端Kx (kN/mm)', '終端Ky (kN/mm)', '終端Kr (kNmm/rad)'],
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
                    { type: 'dropdown', source: ['Rigid', 'Pin', 'Spring'] },
                    { type: 'dropdown', source: ['Rigid', 'Pin', 'Spring'] },
                    { type: 'text' },
                    { type: 'text' },
                    { type: 'text' },
                    { type: 'text' },
                    { type: 'text' },
                    { type: 'text' },
                ],
                colWidths: [60, 60, 80, 80, 80, 80, 80, 60, 50, 80, 100, 60, 80, 80, 90, 90, 100, 90, 90, 100],
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

    initNodesSheet();

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

                let conn1 = row[12] || 'Rigid';
                let conn2 = row[13] || 'Rigid';
                if (`${conn1}`.toLowerCase() === 'pin') conn1 = 'Pinned';
                if (`${conn2}`.toLowerCase() === 'pin') conn2 = 'Pinned';

                members.push({
                    node1: n1, node2: n2,
                    E: row[2], F: row[3],
                    I: row[4], A: row[5], Z: row[6], i: row[7],
                    K: row[8], density: row[9],
                    name: row[10], axis: row[11],
                    conn1: conn1, conn2: conn2,
                    spring_i_Kx: row[14], spring_i_Ky: row[15], spring_i_Kr: row[16],
                    spring_j_Kx: row[17], spring_j_Ky: row[18], spring_j_Kr: row[19]
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
