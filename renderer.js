import * as pdfjsLib from './lib/pdf.mjs';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

// --- Global State ---
let editMode = false;
let pdfDoc; // For pdf-lib editing
let currentPageNum = 1;
let totalPages = 0;
let currentFileBytes = null; // Store the raw bytes of the current PDF

// --- DOM Elements ---
const openPdfButton = document.getElementById('open-pdf');
const editModeButton = document.getElementById('edit-mode');
const savePdfButton = document.getElementById('save-pdf');
const addPageButton = document.getElementById('add-page');
const deletePageButton = document.getElementById('delete-page');
const movePageUpButton = document.getElementById('move-page-up');
const movePageDownButton = document.getElementById('move-page-down');
const pdfContainer = document.getElementById('pdf-container');
const pdfCanvas = document.getElementById('pdf-canvas');
const textLayer = document.getElementById('text-layer');
const thumbnailSidebar = document.getElementById('thumbnail-sidebar');

// --- Setup ---
pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.mjs';

// --- Core Functions ---

async function loadPdf(pdfBytes) {
    currentFileBytes = pdfBytes;
    // Use a copy for rendering so we don't alter the original array buffer
    const renderBytes = pdfBytes.slice(0);

    pdfDoc = await PDFDocument.load(pdfBytes);
    const pdfjsDoc = await pdfjsLib.getDocument(renderBytes).promise;

    totalPages = pdfjsDoc.numPages;

    if (totalPages === 0) {
        // If no pages, clear the view
        clearViewer();
    } else {
        await renderThumbnails(pdfjsDoc);
        // Ensure currentPageNum is valid
        if (currentPageNum > totalPages) {
            currentPageNum = totalPages;
        }
        if (currentPageNum < 1) {
            currentPageNum = 1;
        }
        await renderPage(currentPageNum, pdfjsDoc);
    }
}

async function renderPage(pageNum, pdf) {
    currentPageNum = pageNum;
    const page = await pdf.getPage(pageNum);
    const scale = 1.5;
    const viewport = page.getViewport({ scale });

    // Prepare main viewer canvas
    pdfContainer.style.width = `${viewport.width}px`;
    pdfContainer.style.height = `${viewport.height}px`;
    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;
    const context = pdfCanvas.getContext('2d');

    await page.render({ canvasContext: context, viewport }).promise;
    await renderTextLayer(page, viewport);

    updateThumbnailSelection();
    updatePageActionButtons();
}

async function renderTextLayer(page, viewport) {
    const textContent = await page.getTextContent();
    textLayer.innerHTML = '';
    textLayer.style.width = `${viewport.width}px`;
    textLayer.style.height = `${viewport.height}px`;

    textContent.items.forEach(item => {
        const textDiv = document.createElement('div');
        const style = textDiv.style;
        style.position = 'absolute';
        style.whiteSpace = 'pre';
        style.color = 'transparent';
        style.transformOrigin = '0% 0%';
        style.cursor = 'text';

        const transform = pdfjsLib.Util.transform(viewport.transform, item.transform);
        style.transform = `matrix(${transform.join(',')})`;
        const fontHeight = Math.sqrt((transform[2] * transform[2]) + (transform[3] * transform[3]));
        style.fontFamily = item.fontName;
        style.fontSize = `${fontHeight}px`;
        style.lineHeight = `${fontHeight}px`;

        textDiv.textContent = item.str;
        textDiv.dataset.itemData = JSON.stringify({
            transform: item.transform,
            width: item.width,
            height: item.height,
            fontName: item.fontName,
            str: item.str,
        });
        textLayer.appendChild(textDiv);
    });
}

async function renderThumbnails(pdf) {
    thumbnailSidebar.innerHTML = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 0.3 });

        const thumbnailItem = document.createElement('div');
        thumbnailItem.className = 'thumbnail-item';
        thumbnailItem.dataset.pageNum = i;

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        thumbnailItem.appendChild(canvas);
        thumbnailItem.appendChild(document.createElement('p')).textContent = `Page ${i}`;
        thumbnailSidebar.appendChild(thumbnailItem);

        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    }
    updateThumbnailSelection();
}

async function modifyPdfText(itemData, newText) {
    if (!pdfDoc) return;

    const page = pdfDoc.getPages()[currentPageNum - 1];
    const { transform, width, height } = itemData;

    // Get position and size from the transform matrix
    const x = transform[4];
    const y = transform[5];
    const fontSize = Math.sqrt(transform[2] * transform[2] + transform[3] * transform[3]);

    // Convert y-coordinate from pdf.js (top-down) to pdf-lib (bottom-up)
    const y_pdflib = page.getHeight() - y;

    // Cover old text with a white rectangle (with padding to ensure full coverage)
    page.drawRectangle({
        x: x - 1,
        y: y_pdflib - (fontSize * 0.3),
        width: width + 2,
        height: height + (fontSize * 0.2),
        color: rgb(1, 1, 1),
    });

    // Draw new text
    page.drawText(newText, {
        x: x,
        y: y_pdflib,
        font: await pdfDoc.embedFont(StandardFonts.Helvetica),
        size: fontSize,
        color: rgb(0, 0, 0),
    });

    const pdfBytes = await pdfDoc.save();
    await loadPdf(pdfBytes); // Reload to ensure view consistency
}

// --- UI Update & Utility Functions ---

function updateThumbnailSelection() {
    document.querySelectorAll('.thumbnail-item').forEach(item => {
        item.classList.toggle('selected', parseInt(item.dataset.pageNum) === currentPageNum);
    });
}

function updatePageActionButtons() {
    const isPageSelected = totalPages > 0;
    deletePageButton.style.display = isPageSelected ? 'inline-block' : 'none';
    movePageUpButton.style.display = isPageSelected && currentPageNum > 1 ? 'inline-block' : 'none';
    movePageDownButton.style.display = isPageSelected && currentPageNum < totalPages ? 'inline-block' : 'none';
}

function clearViewer() {
    thumbnailSidebar.innerHTML = '';
    pdfCanvas.getContext('2d').clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
    textLayer.innerHTML = '';
    totalPages = 0;
    currentPageNum = 1;
    pdfDoc = null;
    currentFileBytes = null;
    updatePageActionButtons();
}

// --- Event Listeners ---

openPdfButton.addEventListener('click', async () => {
    const filePath = await window.electronAPI.openFile();
    if (filePath) {
        const pdfBytes = await window.electronAPI.readFile(filePath);
        await loadPdf(pdfBytes);
    }
});

editModeButton.addEventListener('click', () => {
    editMode = !editMode;
    editModeButton.textContent = editMode ? 'Exit Edit Mode' : 'Edit Mode';
    savePdfButton.style.display = editMode ? 'inline-block' : 'none';
    textLayer.style.pointerEvents = editMode ? 'auto' : 'none';
});

thumbnailSidebar.addEventListener('click', async (e) => {
    const item = e.target.closest('.thumbnail-item');
    if (item) {
        const pageNum = parseInt(item.dataset.pageNum);
        if (pageNum !== currentPageNum) {
            const pdfjsDoc = await pdfjsLib.getDocument(currentFileBytes.slice(0)).promise;
            await renderPage(pageNum, pdfjsDoc);
        }
    }
});

addPageButton.addEventListener('click', async () => {
    if (!pdfDoc) {
        pdfDoc = await PDFDocument.create();
    }
    pdfDoc.addPage();
    currentPageNum = pdfDoc.getPageCount();
    const pdfBytes = await pdfDoc.save();
    await loadPdf(pdfBytes);
});

deletePageButton.addEventListener('click', async () => {
    if (!pdfDoc || totalPages === 0) return;
    pdfDoc.removePage(currentPageNum - 1);
    const pdfBytes = await pdfDoc.save();
    await loadPdf(pdfBytes);
});

movePageUpButton.addEventListener('click', async () => {
    if (!pdfDoc || currentPageNum <= 1) return;
    pdfDoc.movePage(currentPageNum - 1, currentPageNum - 2);
    currentPageNum--;
    const pdfBytes = await pdfDoc.save();
    await loadPdf(pdfBytes);
});

movePageDownButton.addEventListener('click', async () => {
    if (!pdfDoc || currentPageNum >= totalPages) return;
    pdfDoc.movePage(currentPageNum - 1, currentPageNum);
    currentPageNum++;
    const pdfBytes = await pdfDoc.save();
    await loadPdf(pdfBytes);
});

savePdfButton.addEventListener('click', async () => {
    if (!pdfDoc) return;
    const pdfBytes = await pdfDoc.save();
    await window.electronAPI.saveFile(pdfBytes);
});

textLayer.addEventListener('click', (e) => {
    if (!editMode || e.target.tagName !== 'DIV' || document.querySelector('#text-layer input')) return;

    const textDiv = e.target;
    const input = document.createElement('input');
    const style = input.style;

    style.position = 'absolute';
    style.transform = textDiv.style.transform;
    style.transformOrigin = '0% 0%';
    style.fontFamily = textDiv.style.fontFamily;
    style.fontSize = textDiv.style.fontSize;
    style.lineHeight = textDiv.style.lineHeight;
    style.border = '1px solid #000';
    style.padding = '0';
    input.value = textDiv.textContent;
    input.style.width = `${textDiv.offsetWidth}px`;

    textDiv.style.display = 'none';
    textLayer.appendChild(input);
    input.focus();

    const onFinishEditing = async () => {
        const itemData = JSON.parse(textDiv.dataset.itemData);
        if (itemData.str !== input.value) {
            await modifyPdfText(itemData, input.value);
        }
        textDiv.textContent = input.value;
        textDiv.style.display = 'block';
        input.remove();
    };

    input.addEventListener('blur', onFinishEditing);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') onFinishEditing();
    });
});

// --- Initial Load ---
(async () => {
    try {
        const response = await fetch('./sample.pdf');
        if (!response.ok) throw new Error('File not found');
        const pdfBytes = await response.arrayBuffer();
        await loadPdf(pdfBytes);
    } catch (error) {
        console.error('Failed to load initial PDF:', error);
        clearViewer(); // Start with a clean state if sample is missing
    }
})();