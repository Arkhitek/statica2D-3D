(function(){
    function setDisplayForGroup(className, visible){
        document.querySelectorAll('.' + className).forEach(el => {
            if(visible) el.classList.remove('hidden-field'); else el.classList.add('hidden-field');
        });
    }

    function setupPopupToggles(){
        document.querySelectorAll('.popup-toggle').forEach(cb => {
            cb.addEventListener('change', () => {
                const t = cb.dataset.target;
                if(!t) return;
                setDisplayForGroup(t, cb.checked);
            });
            // initialize
            try { cb.dispatchEvent(new Event('change')); } catch(e) {}
        });
    }

    function setupColToggles(){
        document.querySelectorAll('.col-toggle').forEach(cb => {
            cb.addEventListener('change', () => {
                const t = cb.dataset.target;
                if(!t) return;
                // toggle header and any elements with the class
                document.querySelectorAll('.' + t).forEach(el => {
                    if(cb.checked) el.classList.remove('hidden-col'); else el.classList.add('hidden-col');
                });
                // also hide/show tbody cells by matching the header column index
                toggleColumnByClass(t, cb.checked);
            });
            try { cb.dispatchEvent(new Event('change')); } catch(e) {}
        });
    }

    // Toggle tbody cells for a header class.
    // Prefer class-based matching on tbody td elements; fall back to header cellIndex if no td classes exist.
    function toggleColumnByClass(headerClass, visible){
        try{
            const ths = document.querySelectorAll('thead th.' + headerClass);
            if(!ths || ths.length === 0) return;
            ths.forEach(th => {
                const tbl = th.closest('table');
                if(!tbl) return;

                // First, try to find tbody td elements that carry the same class
                const tdByClass = tbl.querySelectorAll('tbody td.' + headerClass);
                if(tdByClass && tdByClass.length > 0){
                    tdByClass.forEach(td => {
                        // Never toggle the delete button cell
                        if (td.querySelector('.delete-row-btn')) return;
                        if(visible) td.classList.remove('hidden-col'); else td.classList.add('hidden-col');
                    });
                    return;
                }

                // Fallback: use header cellIndex (for rows that don't have per-td classes)
                const idx = th.cellIndex;
                tbl.querySelectorAll('tbody tr').forEach(tr => {
                    const cell = tr.cells[idx];
                    if(cell){
                        if (cell.querySelector('.delete-row-btn')) return;
                        if(visible) cell.classList.remove('hidden-col'); else cell.classList.add('hidden-col');
                    }
                });
            });
        }catch(e){
            // ignore
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        try{
            setupPopupToggles();
            setupColToggles();
        }catch(e){
            console.error('visibility_controls init error', e);
        }
    });
})();
