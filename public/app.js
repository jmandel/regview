// Import 'marked' from esm.sh
import * as markedimport from 'https://www.unpkg.com/marked';
console.log(marked)

// Fetch and parse the JSON data
async function fetchData() {
    return (await fetch('summary.json')).json()
}

// Function to safely set innerHTML
function setInnerHTML(element, html) {
    element.innerHTML = html;
}

// Render Markdown content
function renderMarkdown(markdown) {
    return marked.parse(markdown);
}

// Render the summary content
function renderSummary(node, depth = 1) {
    let html = `<h${depth} id="summary-${JSON.stringify(node.path)}">
    ${node.title}
    <a href="#full-text-${JSON.stringify(node.path)}">🔗</a>
    </h${depth}>`;

    if (node.summary) 
    html += `<div style="background: lightblue;">Summary: ` +
        renderMarkdown(node.summary.summary) + `</div>`;

    if (node.summary?.changesFromProposal) {
        html += `<div style="background: lightgreen;">Changes from Proposal: ` + renderMarkdown(node.summary.changesFromProposal) + `</div>`;
    }
    if (node.summary?.keyPointsByAudience) {
        html += '<div style="background: #ccc">Key Points: <ul>';
        node.summary.keyPointsByAudience.forEach(kp => {
            html += `<li><strong>${kp.audience}:</strong> ${renderMarkdown(kp.point)}</li>`;
        });
        html += '</ul></div>';
    }

    node.children.forEach(child => {
        html += renderSummary(child, depth + 1);
    });

    return html;
}

function renderFullText(node, depth = 1) {
    let html = `<h${depth} id="full-text-${JSON.stringify(node.path)}"
    >
    <a href="#full-text-${JSON.stringify(node.path)}">🔗</a>
    ${node.title}</h${depth}>`;
    html += renderMarkdown(node.text);

    node.children.forEach(child => {
        html += renderFullText(child, depth + 1);
    });

    return html;
}

// Assuming the full text pane has the id "full-text-pane"
const fullTextPane = document.getElementById('full-text-pane');
fullTextPane.addEventListener('scroll', () => {
    const headings = Array.from(fullTextPane.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    const topmostVisibleHeading = headings.find(isElementInViewport);
    console.log(topmostVisibleHeading);
    if (topmostVisibleHeading?.id) {
        const id = topmostVisibleHeading.id.replace('full-text-', '');
        console.log("match", id);
        const summaryElement = document.getElementById(`summary-${id}`);
        console.log(summaryElement);
        if (summaryElement) {
            // scroll the summary Element into view so its client rect offset ist he same as the topmistVisibleHEading's
            summaryElement.scrollIntoView();
            // scroll the summary pane up by the height of the topmostVisibleHeading
            summaryElement.parentElement.scrollTop -= topmostVisibleHeading.getBoundingClientRect().y;

        }
    }
});

function isElementInViewport(el) {
    const rect = el.getBoundingClientRect();
    //console.log(el, rect);
    return (
        rect.top >= 0 && rect.bottom <= (window.innerHeight || document.documentElement.clientHeight)
    );
}
// Main function to render the data
async function renderData() {
    const data = (await fetchData()).children[3];
    console.log(data);
    if (data) {
        const summaryPane = document.getElementById('summary-pane');
        const fullTextPane = document.getElementById('full-text-pane');

        summaryPane.innerHTML = renderSummary(data);
        fullTextPane.innerHTML = renderFullText(data);
        if (window.location.hash) {
            // scroll to the element with the hash
            const element = document.getElementById(window.location.hash.substr(1));
            if (element) {
                element.scrollIntoView();
            }
        }
    }
}

// Call the main function
renderData();
