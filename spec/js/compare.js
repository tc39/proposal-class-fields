"use strict";

const REPO_URL = "https://github.com/tc39/ecma262";

function sleep(t) {
  return new Promise(r => setTimeout(r, t));
}

// Insert list marker into list element.
//
// While creating diff, extra list element can be added.
// In that case, the default CSS list marker is affected by the change.
//
// So, instead of using CSS list marker in the diff view, insert text list
// marker in the list element.
//
// This code is based on
// https://hg.mozilla.org/mozilla-central/raw-file/fffcb4bbc8b17a34f5fa5013418a8956d0fdcc7a/layout/generic/nsBulletFrame.cpp
class ListMarkUtils {
  static getListDepth(node) {
    let depth = 0;
    while (node && node !== document.body) {
      if (node.nodeName.toLowerCase() === "ol") {
        depth++;
      }
      node = node.parentNode;
    }
    return depth;
  }

  static decimalToText(ordinal) {
    return ordinal.toString(10);
  }

  static romanToText(ordinal, achars, bchars) {
    if (ordinal < 1 || ordinal > 3999) {
      this.decimalToText(ordinal);
      return false;
    }
    let addOn;
    const decStr = ordinal.toString(10);
    const len = decStr.length;
    let romanPos = len;
    let result = "";

    for (let i = 0; i < len; i++) {
      const dp = decStr.substr(i, 1);
      romanPos--;
      addOn = "";
      switch(dp) {
        case "3":
          addOn += achars[romanPos];
          // FALLTHROUGH
        case "2":
          addOn += achars[romanPos];
          // FALLTHROUGH
        case "1":
          addOn += achars[romanPos];
          break;
        case "4":
          addOn += achars[romanPos];
          // FALLTHROUGH
        case "5": case "6":
        case "7": case "8":
          addOn += bchars[romanPos];
          for (let n = 0; "5".charCodeAt(0) + n < dp.charCodeAt(0); n++) {
            addOn += achars[romanPos];
          }
          break;
        case "9":
          addOn += achars[romanPos];
          addOn += achars[romanPos+1];
          break;
        default:
          break;
      }
      result += addOn;
    }
    return result;
  }

  static charListToText(ordinal, chars) {
    const base = chars.length;
    let buf = "";
    if (ordinal < 1) {
      return this.decimalToText(ordinal);
    }
    do {
      ordinal--;
      const cur = ordinal % base;
      buf = chars.charAt(cur) + buf;
      ordinal = Math.floor(ordinal / base);
    } while (ordinal > 0);
    return buf;
  }

  static toListMark(i, depth) {
    if (depth === 1 || depth === 4) {
      return this.decimalToText(i + 1);
    }
    if (depth === 2 || depth === 5) {
      return this.charListToText(i + 1, "abcdefghijklmnopqrstuvwxyz");
    }
    if (depth === 3 || depth === 6) {
      return this.romanToText(i + 1, "ixcm", "vld");
    }

    return this.decimalToText(i + 1);
  }

  static textify(box) {
    for (const ol of box.getElementsByTagName("ol")) {
      const depth = this.getListDepth(ol);

      let i = 0;
      for (const li of ol.children) {
        if (li.nodeName.toLowerCase() !== "li") {
          continue;
        }

        const mark = document.createTextNode(`${this.toListMark(i, depth)}. `);
        li.insertBefore(mark, li.firstChild);

        i++;
      }
    }
  }
}

class PromiseWorker {
  constructor(path) {
    this.nextId = 0;
    this.resolveMap = {};
    this.worker = new Worker(path);
    this.worker.onmessage = msg => {
      const id = msg.data.id;
      const resolve = this.resolveMap[id];
      delete this.resolveMap[id];
      resolve(msg.data.data);
    };
  }

  async run(data) {
    const id = this.nextId;
    this.nextId++;
    if (this.nextId > 1000000) {
      this.nextId = 0;
    }

    return new Promise(resolve => {
      this.resolveMap[id] = resolve;

      this.worker.postMessage({
        data,
        id,
      });
    });
  }
}

const HTMLPathDiffWorker = new PromiseWorker("./js/path-diff-worker.js?20200930-a");
const HTMLTreeDiffWorker = new PromiseWorker("./js/tree-diff-worker.js?20200930-a");

class HTMLPathDiff {
  static diff(s1, s2) {
    return HTMLPathDiffWorker.run({
      s1,
      s2,
      type: "diff",
    });
  }

  static splitForDiff(s1, s2) {
    return HTMLPathDiffWorker.run({
      s1,
      s2,
      type: "splitForDiff",
    });
  }
}

// Calculate diff between 2 DOM tree.
class HTMLTreeDiff {
  constructor() {
    this.blockNodes = new Set(
      [
        "div", "p", "pre",
        "emu-annex", "emu-clause", "emu-figure",
        "emu-note",
        "figcaption", "figure",
        "h1", "h2",
        "ol", "ul", "li",
        "dl", "dt", "dd",
        "table", "thead", "tbody", "tr", "th", "td",
      ]
    );
  }

  // Calculate diff between 2 DOM tree.
  async diff(diffNode, node1, node2) {
    this.addNumbering("1-", node1);
    this.addNumbering("2-", node2);

    await this.splitForDiff(node1, node2);

    this.combineNodes(node1, "li");
    this.combineNodes(node2, "li");

    const nodeObj1 = this.DOMTreeToPlainObject(node1);
    const nodeObj2 = this.DOMTreeToPlainObject(node2);

    const diffNodeObj = await HTMLTreeDiffWorker.run({
      nodeObj1,
      nodeObj2,
    });

    const tmp = this.plainObjectToDOMTree(diffNodeObj);
    for (const child of [...tmp.childNodes]) {
      diffNode.appendChild(child);
    }

    this.combineNodes(diffNode, "*");

    this.swapInsDel(diffNode);

    this.removeNumbering(diffNode);
  }

  // Convert DOM tree to object tree.
  DOMTreeToPlainObject(node) {
    const result = this.DOMElementToPlainObject(node);

    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (this.isUnnecessaryText(child)) {
          continue;
        }

        result.textLength += this.compressSpaces(child.textContent).length;
        this.splitTextInto(result.childNodes, child.textContent);
        continue;
      }

      if (child.nodeType === Node.ELEMENT_NODE) {
        const childObj = this.DOMTreeToPlainObject(child);
        result.childNodes.push(childObj);
        result.textLength += childObj.textLength;
      }
    }

    return result;
  }

  compressSpaces(s) {
    return s.replace(/\s+/, " ");
  }

  // Remove unnecessary whitespace texts that can confuse diff algorithm.
  //
  // Diff algorithm used here isn't good at finding diff in repeating
  // structure, such as list element, separated by same whitespaces.
  //
  // Remove such whitespaces between each `li`, to reduce the confusion.
  isUnnecessaryText(node) {
    if (!/^[ \r\n\t]*$/.test(node.textContent)) {
      return false;
    }

    if (node.previousSibling) {
      if (node.previousSibling.nodeType === Node.COMMENT_NODE ||
          this.isBlock(node.previousSibling)) {
        return true;
      }
    }
    if (node.nextSibling) {
      if (node.nextSibling.nodeType === Node.COMMENT_NODE ||
          this.isBlock(node.nextSibling)) {
        return true;
      }
    }

    return false;
  }

  isBlock(node) {
    const name = node.nodeName.toLowerCase();
    return this.blockNodes.has(name);
  }

  // Convert single DOM element to object, without child nodes.
  DOMElementToPlainObject(node) {
    const attributes = {};
    if (node.attributes) {
      for (const attr of node.attributes) {
        attributes[attr.name] = attr.value;
      }
    }

    return this.createPlainObject(
      node.nodeName.toLowerCase(), node.id, attributes);
  }

  // Create a plain object representation for an empty DOM element.
  createPlainObject(name, id = undefined, attributes = {}) {
    return {
      attributes,
      childNodes: [],
      id,
      name,
      textLength: 0,
    };
  }

  // Split text by whitespaces and punctuation, given that
  // diff is performed on the tree of nodes, and text is the
  // minimum unit.
  //
  // Whitespaces are appended to texts before it, instead of creating Text
  // node with whitespace alone.
  // This is necessary to avoid matching each whitespace in different sentence.
  splitTextInto(childNodes, text) {
    while (true) {
      const spaceIndex = text.search(/\s[^\s]/);
      const punctIndex = text.search(/[.,:;?!()[\]]/);
      if (spaceIndex === -1 && punctIndex === -1) {
        break;
      }

      if (punctIndex !== -1 && (spaceIndex === -1 || punctIndex < spaceIndex)) {
        if (punctIndex > 0) {
          childNodes.push(text.slice(0, punctIndex));
        }
        childNodes.push(text.slice(punctIndex, punctIndex + 1));
        text = text.slice(punctIndex + 1);
      } else {
        childNodes.push(text.slice(0, spaceIndex + 1));
        text = text.slice(spaceIndex + 1);
      }
    }
    if (text) {
      childNodes.push(text);
    }
  }

  // Add unique ID ("tree-diff-num" attribute) to each element.
  //
  // See `splitForDiff` for more details.
  addNumbering(prefix, node) {
    let i = 0;
    for (const child of node.getElementsByTagName("*")) {
      child.setAttribute("tree-diff-num", prefix + i);
      i++;
    }
  }

  // Split both DOM tree, using text+path based LCS, to have similar tree
  // structure.
  //
  // This is a workaround for the issue that raw tree LCS cannot handle
  // split/merge.
  //
  // To solve the issue, split both tree by `splitForDiff` to make each text
  // match even if parent tree gets split/merged.
  //
  // This caused another issue when `splitForDiff` split more than necessary
  // (like, adding extra list element).
  //
  // Such nodes are combined in `combineNodes`, based on the unique ID
  // added by `addNumbering`, and those IDs are removed in `removeNumbering`.
  //
  // Also, `LCSToDiff` always places `ins` after `del`, but `combineNodes` can
  // merge 2 nodes where first one ends with `ins` and the second one starts
  // with `del`. `swapInsDel` fixes up the order.
  async splitForDiff(node1, node2) {
    const [html1, html2] = await HTMLPathDiff.splitForDiff(
      node1.innerHTML, node2.innerHTML);
    node1.innerHTML = html1;
    node2.innerHTML = html2;
  }

  // Convert object tree to DOM tree.
  plainObjectToDOMTree(nodeObj) {
    if (typeof nodeObj === "string") {
      return document.createTextNode(nodeObj);
    }

    const result = document.createElement(nodeObj.name);
    for (const [key, value] of Object.entries(nodeObj.attributes)) {
      result.setAttribute(key, value);
    }
    for (const child of nodeObj.childNodes) {
      result.appendChild(this.plainObjectToDOMTree(child));
    }

    return result;
  }

  // Combine adjacent nodes with same ID ("tree-diff-num" attribute) into one
  //
  // See `splitForDiff` for more details.
  combineNodes(node, name) {
    const removedNodes = new Set();

    for (const child of [...node.getElementsByTagName(name)]) {
      if (removedNodes.has(child)) {
        continue;
      }

      if (!child.hasAttribute("tree-diff-num")) {
        continue;
      }

      const num = child.getAttribute("tree-diff-num");
      while (true) {
        if (!child.nextSibling) {
          break;
        }

        if (!(child.nextSibling instanceof Element)) {
          break;
        }

        const next = child.nextSibling;
        if (next.getAttribute("tree-diff-num") !== num) {
          break;
        }

        while (next.firstChild) {
          child.appendChild(next.firstChild);
        }

        removedNodes.add(next);
        next.remove();
      }
    }
  }

  // Swap `ins`+`del` to `del`+`ins`.
  //
  // See `splitForDiff` for more details.
  swapInsDel(node) {
    for (const child of [...node.getElementsByClassName("htmldiff-ins")]) {
      if (!child.nextSibling) {
        continue;
      }

      if (!(child.nextSibling instanceof Element)) {
        continue;
      }

      if (child.nextSibling.classList.contains("htmldiff-del")) {
        child.before(child.nextSibling);
      }
    }
  }

  // Add "tree-diff-num" attribute from all elements.
  //
  // See `splitForDiff` for more details.
  removeNumbering(node) {
    for (const child of node.getElementsByTagName("*")) {
      child.removeAttribute("tree-diff-num");
    }
  }
}

class DateUtils {
  static toReadable(d) {
    try {
      const date = new Date(d);
      return date.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
    } catch (e) {
      return d;
    }
  }

  static toRelativeTime(d) {
    try {
      const date = new Date(d);
      const now = new Date();
      const sec = Math.floor(now.getTime() - date.getTime()) / 1000;
      if (sec < 0) {
        return "";
      }
      if (sec <= 1) {
        return "now, ";
      }
      if (sec < 60) {
        return `${sec} seconds ago, `;
      }
      const min = Math.floor(sec / 60);
      if (min === 1) {
        return "1 minute ago, ";
      }
      if (min < 60) {
        return `${min} minutes ago, `;
      }
      const hour = Math.floor(min / 60);
      if (hour === 1) {
        return "1 hour ago, ";
      }
      if (hour < 24) {
        return `${hour} hours ago, `;
      }
      const day = Math.floor(hour / 24);
      if (day === 1) {
        return "yesterday, ";
      }
      return `${day} days ago, `;
    } catch (e) {
      return "";
    }
  }
}

// ECMAScript Language Specification Comparator
class Comparator {
  constructor() {
    this.headerCollapsed = false;

    // The `sections.json` data for the currently selected "from" revision.
    this.fromSecData = {};

    // The `sections.json` data for the currently selected "to" revision.
    this.toSecData = {};

    // `True` if diff calculation is ongoing.
    this.processing = false;

    // Set to `True` to tell the currently ongoing diff calculation to abort.
    this.abortProcessing = false;

    this.header = document.getElementById("header");
    this.collapsedHeaderLine = document.getElementById("collapsed-header-line");
    this.collapsedSubject = document.getElementById("collapsed-header-line-subject");
    this.collapsedSubjectLink = document.getElementById("collapsed-header-line-subject-link");
    this.collapsedAuthor = document.getElementById("collapsed-header-line-author-and-date");
    this.collapsedStat = document.getElementById("collapsed-header-line-stat");
    this.prFilter = document.getElementById("pr-filter");
    this.revFilter = document.getElementById("rev-filter");
    this.fromRev = document.getElementById("from-rev");
    this.toRev = document.getElementById("to-rev");
    this.secList = document.getElementById("sec-list");
    this.secIdList = [];
    this.secSearchField = document.getElementById("sec-search");
    this.secDataMap = {};
    this.secAll = document.getElementById("sec-all");
    this.secSubtree = document.getElementById("sec-subtree");
    this.prLink = document.getElementById("pr-link");
    this.fromLink = document.getElementById("from-history-link");
    this.toLink = document.getElementById("to-history-link");
    this.result = document.getElementById("result");
    this.diffStat = document.getElementById("diff-stat");
    this.secHit = document.getElementById("sec-hit");
    this.viewDiff = document.getElementById("view-diff");
    this.viewFrom = document.getElementById("view-from");
    this.viewTo = document.getElementById("view-to");
    this.viewFromTab = document.getElementById("view-from-tab");
    this.viewToTab = document.getElementById("view-to-tab");
    this.viewDiffTab = document.getElementById("view-diff-tab");
    this.workBoxContainer = document.getElementById("work-box-container");
    this.pathDiff = document.getElementById("path-diff");
    this.scroller = document.getElementById("scroller");
    this.searchField = document.getElementById("search");
    this.revsAndPRsList = document.getElementById("revs-and-prs-list");
    this.secDataList = document.getElementById("sec-data-list");
    this.revsAndPRs = [];
    this.revsAndPRsMap = {};
    this.messageOverlay = document.getElementById("message-overlay");
    this.messageBox = document.getElementById("message-box");

    this.currentQuery = "";

    this.notfoundPR = undefined;
    this.notfoundRev = undefined;

    this.compareTimer = null;
  }

  async run() {
    await this.loadResources();
    this.populateLists();

    await this.parseQuery();
  }

  async loadResources() {
    [this.revs, this.prs] = await Promise.all([
      this.getJSON("./history/revs.json"),
      this.getJSON("./history/prs.json"),
    ]);

    this.revMap = {};
    for (const rev of this.revs) {
      this.revMap[rev.hash] = rev;
    }

    this.prMap = {};
    for (const pr of this.prs) {
      pr.parent = this.getFirstParent(pr.revs[pr.revs.length-1]);
      this.prMap[pr.number] = pr;
    }
  }

  // Return the first parent of `rev`.
  // `rev.parents` can contain multiple hash if it's a merge.
  getFirstParent(rev) {
    return rev.parents.split(" ")[0];
  }

  async getJSON(path) {
    const response = await fetch(path);
    if (!response.ok) {
      return undefined;
    }
    return response.json();
  }

  populateLists() {
    this.populatePRs(this.prFilter);
    this.populateRevs(this.revFilter);
    this.populateAllRevs(this.fromRev);
    this.populateAllRevs(this.toRev);
    this.populateRevsAndPRs(
      this.revsAndPRsList, this.revsAndPRs, this.revsAndPRsMap);
  }

  // Populate PR filter.
  populatePRs(menu) {
    while (menu.firstChild) {
      menu.firstChild.remove();
    }

    const opt = document.createElement("option");
    opt.value = "-";
    opt.textContent = "-";
    menu.appendChild(opt);

    const MAX_TITLE_LENGTH = 80;

    for (const pr of this.prs) {
      const opt = document.createElement("option");
      opt.value = pr.number;
      let title = pr.title;
      if (title.length > MAX_TITLE_LENGTH) {
        title = title.slice(0, MAX_TITLE_LENGTH - 1) + "\u2026";
      }
      opt.textContent = `#${pr.number}: ${title} (${pr.login}/${pr.ref})`;
      menu.appendChild(opt);
    }

    menu.value = "-";
  }

  // Populate Revision filter.
  populateRevs(menu) {
    while (menu.firstChild) {
      menu.firstChild.remove();
    }

    const opt = document.createElement("option");
    opt.value = "-";
    opt.textContent = "-";
    menu.appendChild(opt);

    const MAX_SUBJECT_LENGTH = 80;

    for (const rev of this.revs) {
      const parent = this.getFirstParent(rev);
      if (!(parent in this.revMap)) {
        continue;
      }

      const opt = document.createElement("option");
      opt.value = rev.hash;
      let subject = rev.subject;
      if (subject.length > MAX_SUBJECT_LENGTH) {
        subject = subject.slice(0, MAX_SUBJECT_LENGTH - 1) + "\u2026";
      }
      opt.textContent = `${rev.hash} (${DateUtils.toReadable(rev.date)}) ${subject}`;
      menu.appendChild(opt);
    }
  }

  // Populate From and To filter.
  populateAllRevs(menu) {
    while (menu.firstChild) {
      menu.firstChild.remove();
    }

    const opt = document.createElement("option");
    opt.value = "-";
    opt.textContent = "-";
    menu.appendChild(opt);

    for (const rev of this.revs) {
      const opt = document.createElement("option");
      opt.value = rev.hash;
      opt.textContent = `${rev.hash} (${DateUtils.toReadable(rev.date)})`;
      menu.appendChild(opt);
    }

    for (const pr of this.prs) {
      const opt = document.createElement("option");
      opt.value = this.prToOptValue(pr);
      opt.textContent = `${pr.head} (PR ${pr.number} by ${pr.login})`;
      menu.appendChild(opt);
    }
  }

  // Populate autocomplete for search.
  populateRevsAndPRs(list, revsAndPRs, map) {
    for (const pr of this.prs) {
      const value = `#${pr.number}`;
      const label = `#${pr.number}: ${pr.title} (${pr.login}/${pr.ref}, head=${pr.head})`;
      revsAndPRs.push({ label, value });
      map[label] = value;

      const opt = document.createElement("option");
      opt.textContent = label;
      list.appendChild(opt);
    }

    for (const rev of this.revs) {
      const value = rev.hash;
      const label = `${rev.hash} (${DateUtils.toReadable(rev.date)}) ${rev.subject}`;
      revsAndPRs.push({ label, value });
      map[label] = value;

      const opt = document.createElement("option");
      opt.textContent = label;
      list.appendChild(opt);
    }
  }

  prToOptValue(pr) {
    return `PR/${pr.number}/${pr.head}`;
  }

  async parseQuery() {
    let query = window.location.search.slice(1);

    if (!query) {
      // Backward compat
      query = window.location.hash.slice(1);
    }

    const items = query.split("&");
    const queryParams = {};
    for (const item of items) {
      const [name, value] = item.split("=");
      try {
        queryParams[name] = decodeURIComponent(value);
      } catch (e) {}
    }

    if ("collapsed" in queryParams) {
      this.headerCollapsed = true;
      this.updateHeader();
    } else {
      this.headerCollapsed = false;
      this.updateHeader();
    }

    let section;
    if ("id" in queryParams) {
      section = queryParams.id;
    }

    if ("secAll" in queryParams) {
      this.secAll.checked = true;
    } else {
      this.secAll.checked = false;
    }

    if ("secSubtree" in queryParams) {
      this.secSubtree.checked = true;
    } else {
      this.secSubtree.checked = false;
    }

    if ("rev" in queryParams) {
      this.updateUI("rev", {
        rev: queryParams.rev,
        section,
      });
    } else if ("pr" in queryParams) {
      this.updateUI("pr", {
        pr: queryParams.pr,
        section,
      });
    } else if ("from" in queryParams && "to" in queryParams) {
      this.updateUI("from-to", {
        from: queryParams.from,
        section,
        to: queryParams.to,
      });
    } else {
      this.updateUI("from-to", {});
    }
  }

  updateHeader() {
    if (this.headerCollapsed) {
      this.header.classList.add("collapsed");
    } else {
      this.header.classList.remove("collapsed");
    }
  }

  async updateUI(type, params) {
    if (type === "rev") {
      const hash = params.rev;
      if (hash in this.revMap) {
        this.revFilter.value = hash;
        this.selectFromToForRev(hash);
      } else {
        this.fromRev.value = "-";
        this.toRev.value = "-";
        this.notfoundRev = hash;
      }

      this.prFilter.value = "-";
    } else if (type === "pr") {
      const prnum = params.pr;
      if (prnum in this.prMap) {
        this.prFilter.value = prnum;
        this.selectFromToForPR(prnum);
        this.updatePRLink(prnum);
      } else {
        this.fromRev.value = "-";
        this.toRev.value = "-";
        if (prnum !== "-") {
          this.notfoundPR = prnum;
        }
      }

      this.revFilter.value = "-";
    } else if (type === "from-to") {
      if ("from" in params) {
        const from = params.from;
        if (from in this.revMap) {
          this.fromRev.value = from;
        } else {
          this.fromRev.value = "-";
        }
      }
      if ("to" in params) {
        const to = params.to;
        if (to in this.revMap) {
          this.toRev.value = to;
        } else {
          this.toRev.value = "-";
        }
      }

      this.revFilter.value = "-";
      this.prFilter.value = "-";
    }

    this.updateHistoryLink();
    this.updateRevInfo();
    await this.updateSectionList();

    if ("section" in params && params.section) {
      this.secList.value = params.section;
    } else if (!this.secAll.checked) {
      this.secList.value = "combined";
    }

    this.updateURL();
    await this.compare();
  }

  selectFromToForPR(prnum) {
    if (prnum in this.prMap) {
      const pr = this.prMap[prnum];
      this.fromRev.value = pr.parent;
      this.toRev.value = this.prToOptValue(pr);
    }
  }

  selectFromToForRev(hash) {
    if (hash in this.revMap) {
      const rev = this.revMap[hash];
      const parent = this.getFirstParent(rev);
      if (parent in this.revMap) {
        this.fromRev.value = parent;
        this.toRev.value = hash;
      }
    }
  }

  updatePRLink(prnum) {
    if (prnum in this.prMap) {
      const pr = this.prMap[prnum];
      this.prLink.href = `${REPO_URL}/pull/${pr.number}`;
      this.prLink.textContent = `Open PR ${pr.number}`;
    } else {
      this.prLink.textContent = "";
    }
  }

  updateHistoryLink() {
    if (this.fromRev.value === "-") {
      this.fromLink.style.display = "none";
    } else {
      this.fromLink.style.display = "inline";
      this.fromLink.href = `./history/${this.fromRev.value}/index.html`;
    }

    if (this.toRev.value === "-") {
      this.toLink.style.display = "none";
    } else {
      this.toLink.style.display = "inline";
      this.toLink.href = `./history/${this.toRev.value}/index.html`;
    }
  }

  updateRevInfo() {
    this.updateRevInfoFor("from", this.fromRev.value);
    this.updateRevInfoFor("to", this.toRev.value);
    this.updateCollapsedHeaderLine();
  }

  updateRevInfoFor(id, name) {
    const subjectLink = document.getElementById(`${id}-rev-subject-link`);
    const note = document.getElementById(`${id}-rev-note`);
    const author = document.getElementById(`${id}-rev-author`);
    const date = document.getElementById(`${id}-rev-date`);

    const m = name.match(/PR\/(\d+)\/(.+)/);
    if (m) {
      const prnum = m[1];
      const pr = this.prMap[prnum];

      subjectLink.textContent = pr.revs[0].subject;
      subjectLink.href = `${REPO_URL}/pull/${pr.number}`;
      if (pr.revs.length > 1) {
        note.textContent = ` + ${pr.revs.length - 1} revisions`;
      } else {
        note.textContent = "";
      }
      author.textContent = `by ${pr.revs[0].author}`;

      const d = pr.revs[0].date;
      date.title = d;
      date.textContent = `(${DateUtils.toRelativeTime(d)}${DateUtils.toReadable(d)})`;
    } else if (name in this.revMap) {
      const rev = this.revMap[name];

      subjectLink.textContent = rev.subject;
      subjectLink.href = `${REPO_URL}/commit/${rev.hash}`;
      note.textContent = "";
      author.textContent = `by ${rev.author}`;

      const d = rev.date;
      date.title = d;
      date.textContent = `(${DateUtils.toRelativeTime(d)}${DateUtils.toReadable(d)})`;
    } else {
      subjectLink.textContent = "-";
      subjectLink.removeAttribute("href");
      note.textContent = "";
      author.textContent = "-";
      date.textContent = "";
    }
  }

  updateCollapsedHeaderLine() {
    const MAX_TITLE_LENGTH = 80;

    const prnum = this.prFilter.value;
    if (prnum in this.prMap) {
      const pr = this.prMap[prnum];

      let title = pr.title;
      if (title.length > MAX_TITLE_LENGTH) {
        title = title.slice(0, MAX_TITLE_LENGTH - 1) + "\u2026";
      }
      this.collapsedSubjectLink.textContent = `PR ${pr.number}`;
      this.collapsedSubjectLink.href = `${REPO_URL}/pull/${pr.number}`;
      this.collapsedSubject.textContent = `: ${title}`;
      this.collapsedAuthor.textContent = `(${pr.login}/${pr.ref})`;
      return;
    }

    const MAX_SUBJECT_LENGTH = 80;

    const hash = this.revFilter.value;
    if (hash in this.revMap) {
      const rev = this.revMap[hash];

      let subject = rev.subject;
      if (subject.length > MAX_SUBJECT_LENGTH) {
        subject = subject.slice(0, MAX_SUBJECT_LENGTH - 1) + "\u2026";
      }
      this.collapsedSubjectLink.textContent =`${hash.slice(0,8)}`;
      this.collapsedSubjectLink.href = `${REPO_URL}/commit/${rev.hash}`;
      this.collapsedSubject.textContent =`${subject}`;
      this.collapsedAuthor.textContent = `by ${rev.author} (${DateUtils.toReadable(rev.date)})`;
      return;
    }

    const from = this.fromRev.value;
    const to = this.toRev.value;
    if (from in this.revMap && to in this.revMap) {
      this.collapsedSubjectLink.textContent = "";
      this.collapsedSubject.textContent = `${from.slice(0,8)} .. ${to.slice(0,8)}`;
      this.collapsedAuthor.textContent = "";
      return;
    }

    this.collapsedSubjectLink.textContent = "";
    this.collapsedSubject.textContent = "";
    this.collapsedAuthor.textContent = "";
  }

  async loadFullDiff() {
    [this.fromSecData, this.toSecData] = await Promise.all([
      this.getSecData(this.fromRev.value),
      this.getSecData(this.toRev.value)
    ]);
  }

  createSecMap() {
    {
      const map = {};
      for (const id in this.fromSecData.secData) {
        map[id] = this.fromSecData.secData[id].num;
      }
      for (const id in this.fromSecData.figData) {
        map[id] = this.fromSecData.figData[id];
      }
      this.fromSecData.map = map;
    }

    {
      const map = {};
      for (const id in this.toSecData.secData) {
        map[id] = this.toSecData.secData[id].num;
      }
      for (const id in this.toSecData.figData) {
        map[id] = this.toSecData.figData[id];
      }
      this.toSecData.map = map;
    }
  }

  async updateSectionList() {
    this.result.textContent = "";
    this.setStat("");

    if (this.fromRev.value === "-" ||
        this.toRev.value === "-") {
      return;
    }

    this.setStat("Loading...");

    let found = false;
    const toHash = this.toRev.value;
    if (!this.secAll.checked && this.getParentOf(toHash) === this.fromRev.value) {
      const result = await this.getJSON(`./history/${toHash}/parent_diff.json`);
      if (result) {
        this.fromSecData = result.from;
        this.toSecData = result.to;
        found = true;
      }
    }

    if (!found) {
      await this.loadFullDiff();
    }

    if (!this.fromSecData || !this.toSecData) {
      this.setStat("");
      this.messageOverlay.classList.add("shown");

      function filterRev(rev) {
        const m = rev.match(/PR\/(\d+)\/(.+)/);
        if (m) {
          return `PR #${m[1]} (${m[2]})`;
        }
        return rev;
      }

      let missing = "";
      if (!this.fromSecData) {
        if (!this.toSecData) {
          missing = `${filterRev(this.fromRev.value)} and ${filterRev(this.toRev.value)} are not found`;
        } else {
          missing = `${filterRev(this.fromRev.value)} is not found`;
        }
      } else {
          missing = `${filterRev(this.toRev.value)} is not found`;
      }

      this.messageBox.textContent = `${missing}. This can happen if the build failed for the revision.`;
    }

    this.createSecMap();

    await this.populateSectionList();
  }

  async populateSectionList() {
    this.result.textContent = "";
    this.setStat("");

    const prevValue = this.secList.value;

    while (this.secList.firstChild) {
      this.secList.firstChild.remove();
    }
    while (this.secDataList.firstChild) {
      this.secDataList.firstChild.remove();
    }
    this.secIdList = [];

    this.secHit.textContent = "";

    const fromSecSet = new Set(this.fromSecData.secList);
    const toSecSet = new Set(this.toSecData.secList);
    const secSet = new Set(this.fromSecData.secList.concat(this.toSecData.secList));

    const showAll = this.secAll.checked;

    const opt = document.createElement("option");
    opt.value = "combined";
    opt.textContent = "Combined view";
    this.secList.appendChild(opt);
    this.secList.value = opt.value;

    let count = 0;
    for (const secId of Array.from(secSet).sort((a, b) => {
      const aTitle = this.getComparableTitle(a);
      const bTitle = this.getComparableTitle(b);
      if (aTitle === bTitle) {
        return 0;
      }
      return aTitle < bTitle ? -1 : 1;
    })) {
      let stat;
      let mark;

      let fromNum = "";
      let toNum = "";

      if (fromSecSet.has(secId)) {
        fromNum = this.fromSecData.secData[secId].num;

        if (toSecSet.has(secId)) {
          toNum = this.toSecData.secData[secId].num;

          if (!this.isChanged(secId)) {
            if (showAll) {
              stat = "same";
              mark = "  ";
            } else {
              this.secIdList.push({
                fromNum,
                id: secId,
                stat: "same",
                toNum,
              });
              continue;
            }
          } else {
            stat = "mod";
            mark = "-+";
          }
        } else {
          stat = "del";
          mark = "-\u00A0";
        }
      } else {
        const toSec = this.toSecData.secData[secId];
        toNum = toSec.num;

        stat = "ins";
        mark = "+\u00A0";
      }

      const opt = document.createElement("option");
      opt.value = secId;

      const title = this.getSectionTitle(secId);

      if (title) {
        opt.textContent = `${mark} ${title.slice(0, 100)}`;
      } else {
        opt.textContent = `${mark} ${secId}`;
      }
      opt.classList.add(stat);

      this.secList.appendChild(opt);
      if (secId === prevValue) {
        this.secList.value = secId;
      }

      this.secDataMap[title] = secId;

      const dataOpt = document.createElement("option");
      dataOpt.textContent = title;
      this.secDataList.appendChild(dataOpt);

      this.secIdList.push({
        fromNum,
        id: secId,
        stat,
        toNum,
      });
      if (stat !== "same") {
        count++;
      }
    }

    if (this.fromRev.value === this.toRev.value) {
      this.secHit.textContent = "";
    } else if (count === 0) {
      this.secHit.textContent = "No difference (changes in markup or something)";
    } else if (count === 1) {
      this.secHit.textContent = `${count} section differs`;
    } else {
      this.secHit.textContent = `${count} sections differ`;
    }
  }

  getParentOf(hash) {
    const m = hash.match(/PR\/(\d+)\/(.+)/);
    if (m) {
      const prnum = m[1];
      const pr = this.prMap[prnum];
      return pr.parent;
    }

    if (hash in this.revMap) {
      const rev = this.revMap[hash];
      return this.getFirstParent(rev);
    }

    return null;
  }

  setStat(t) {
    this.collapsedStat.textContent = t;
    this.diffStat.textContent = t;
  }

  async getSecData(hash) {
    return this.getJSON(`./history/${hash}/sections.json`);
  }

  // Returns a string representation of section number+title that is comparable
  // with comparison operator.
  //
  // `secId` is the id of the section's header element.
  //
  // Each section number component is replaced with single code unit with the
  // number.
  getComparableTitle(secId) {
    const t = this.getSectionTitle(secId);
    return t.replace(/([0-9]+)/g, matched => String.fromCharCode(matched));
  }

  // Returns section number + title for the section.
  //
  // `secId` is the id of the section's header element.
  getSectionTitle(secId) {
    if (secId in this.fromSecData.secData) {
      const sec = this.fromSecData.secData[secId];
      return `${sec.num} ${this.filterSecTitle(sec.title)}`;
    }

    if (secId in this.toSecData.secData) {
      const sec = this.toSecData.secData[secId];
      return `${sec.num} ${this.filterSecTitle(sec.title)}`;
    }

    return "";
  }

  filterSecTitle(title) {
    const m = title.match(/^(#[^ ]+)+ +(.+)/);
    if (!m) {
      return title;
    }
    return `[${m[1]}] ${m[2]}`;
  }

  // Returns whether the section is changed, added, or removed between from/to
  // revisions.
  isChanged(secId) {
    // This should be synced with SectionsComparator#is_changed in build.py
    const fromHTML = this.fromSecData.secData[secId].html;
    const toHTML = this.toSecData.secData[secId].html;

    const fromHTMLFiltered = this.filterAttributeForComparison(fromHTML);
    const toHTMLFiltered = this.filterAttributeForComparison(toHTML);

    return fromHTMLFiltered !== toHTMLFiltered;
  }

  // Filter attributes that should be ignored when comparing 2 revisions.
  filterAttributeForComparison(s) {
    // This should be synced with
    // SectionsComparator#filter_attribute_for_comparison in build.py

    return s
      .replace(/ (aoid|href)="[^"]+"/g, "");
  }

  updateURL(replace=false) {
    const id = this.secList.value;

    const params = [];
    const prnum = this.prFilter.value;
    const hash = this.revFilter.value;
    if (prnum !== "-") {
      params.push(`pr=${prnum}`);
      if (id !== "combined") {
        params.push(`id=${encodeURIComponent(id)}`);
      }
    } else if (hash !== "-") {
      params.push(`rev=${hash}`);
      if (id !== "combined") {
        params.push(`id=${encodeURIComponent(id)}`);
      }
    } else {
      const from = this.fromRev.value;
      const to = this.toRev.value;
      if (from !== "-" && to !== "-" && from !== to) {
        params.push(`from=${from}`);
        params.push(`to=${to}`);
        if (id !== "combined") {
          params.push(`id=${encodeURIComponent(id)}`);
        }
      }
    }

    if (this.secAll.checked) {
      params.push(`secAll=true`);
    }
    if (this.secSubtree.checked) {
      params.push(`secSubtree=true`);
    }

    if (this.headerCollapsed) {
      params.push("collapsed=1");
    }

    const query = params.length > 0 ? `?${params.join("&")}` : "";
    if (query !== this.currentQuery) {
      this.currentQuery = query;

      const url = window.location.origin + window.location.pathname + query;

      if (replace) {
        window.history.replaceState({}, document.title, url);
      } else {
        window.history.pushState({}, document.title, url);
      }
    }
  }

  async compare() {
    const isSameRev = this.fromRev.value === this.toRev.value;
    const missingRev = this.fromRev.value === "-" || this.toRev.value === "-";
    const empty = isSameRev || this.notfoundPR || missingRev;
    if (empty) {
      if (this.notfoundPR) {
        this.messageOverlay.classList.add("shown");
        this.messageBox.textContent = `PR ${this.notfoundPR} is not found. This can happen if the the history data isn't yet deployed. Try again 10 minutes later.`;
        this.notfoundPR = undefined;
      } else if (this.notfoundRev) {
        this.messageOverlay.classList.add("shown");
        this.messageBox.textContent = `Revision ${this.notfoundRev} is not found. This can happen if the revision is too old.`;
        this.notfoundRev = undefined;
      } else {
        this.messageBox.textContent = "";
      }

      document.documentElement.classList.add("help");
      this.result.textContent = "";
      this.setStat("");
      return;
    }
    this.messageBox.textContent = "";
    this.messageOverlay.classList.remove("shown");
    document.documentElement.classList.remove("help");

    const secList = [];
    if (this.secList.value === "combined") {
      this.result.classList.add("combined");

      for (const { stat, id }  of this.secIdList) {
        if (stat === "same") {
          continue;
        }

        const fromHTML = this.getSectionHTML(this.fromSecData, id);
        const toHTML = this.getSectionHTML(this.toSecData, id);
        secList.push([id, fromHTML, toHTML]);
      }
    } else if (this.secSubtree.checked) {
      const rootId = this.secList.value;

      let fromRootNum = "";
      let toRootNum = "";
      if (rootId in this.fromSecData.secData) {
        fromRootNum = this.fromSecData.secData[rootId].num;
      }
      if (rootId in this.toSecData.secData) {
        toRootNum = this.toSecData.secData[rootId].num;
      }
      this.result.classList.add("combined");

      for (const { stat, id, fromNum, toNum } of this.secIdList) {
        if (stat === "same") {
          continue;
        }

        if (fromRootNum && fromNum) {
          if (fromRootNum !== fromNum &&
              !fromNum.startsWith(fromRootNum + ".")) {
            continue;
          }
        }
        if (toRootNum && toNum) {
          if (toRootNum !== toNum &&
              !toNum.startsWith(toRootNum + ".")) {
            continue;
          }
        }

        const fromHTML = this.getSectionHTML(this.fromSecData, id);
        const toHTML = this.getSectionHTML(this.toSecData, id);
        secList.push([id, fromHTML, toHTML]);
      }
    } else {
      this.result.classList.remove("combined");
      const id = this.secList.value;

      const fromHTML = this.getSectionHTML(this.fromSecData, id);
      const toHTML = this.getSectionHTML(this.toSecData, id);
      secList.push([id, fromHTML, toHTML]);
    }

    if (this.viewDiff.checked) {
      this.result.classList.add("diff-view");

      this.viewFromTab.classList.remove("selected");
      this.viewToTab.classList.remove("selected");
      this.viewDiffTab.classList.add("selected");

      const sections = new Map();
      let differ = false;
      for (const [id, fromHTML, toHTML] of secList) {
        if (fromHTML !== toHTML) {
          differ = true;
        }
        sections.set(id, [fromHTML, toHTML]);
      }

      await this.combineSections(sections, "diff");

      const ins = this.result.getElementsByClassName("htmldiff-ins").length;
      const del = this.result.getElementsByClassName("htmldiff-del").length;

      let note = "";
      if (ins === 0 && del === 0 && differ) {
        note = " (changes in markup or something)";
      }

      if (ins === 0 && del === 0) {
        this.scroller.style.display = "none";
      } else {
        this.scroller.style.display = "block";
      }

      this.setStat(`+${ins} -${del}${note}`);
    } else {
      this.scroller.style.display = "none";
      this.result.classList.remove("diff-view");

      if (this.viewFrom.checked) {
        this.viewFromTab.classList.add("selected");
        this.viewToTab.classList.remove("selected");
        this.viewDiffTab.classList.remove("selected");

        const sections = new Map();
        for (const [id, fromHTML, _toHTML] of secList) {
          sections.set(id, fromHTML);
        }

        await this.combineSections(sections, "from");
      } else if (this.viewTo.checked) {
        this.viewFromTab.classList.remove("selected");
        this.viewToTab.classList.add("selected");
        this.viewDiffTab.classList.remove("selected");

        const sections = new Map();
        for (const [id, _fromHTML, toHTML] of secList) {
          sections.set(id, toHTML);
        }

        await this.combineSections(sections, "to");
      } else {
        this.result.textContent = "";
      }

      this.setStat("");
    }
  }

  getSectionHTML(data, secId) {
    if (data.secData && secId in data.secData) {
      return data.secData[secId].html;
    }
    return null;
  }

  async combineSections(sections, type) {
    if (this.processing) {
      this.abortProcessing = true;
      do {
        await sleep(100);
      } while (this.processing);
      this.abortProcessing = false;
    }

    this.processing = true;

    let i = 0;

    const len = sections.size;

    this.result.textContent = "";
    for (const [id, HTML] of sections) {
      i++;
      this.setStat(`generating sections... ${i}/${len}`);
      if (this.abortProcessing) {
        break;
      }

      let box;
      if (type === "diff") {
        const workBox = document.createElement("div");
        this.workBoxContainer.appendChild(workBox);

        await this.createDiff(workBox, HTML[0], HTML[1]);

        workBox.remove();

        box = document.getElementById(`excluded-${id}`);
        if (box) {
          const parentInsDel = this.findParentInsDel(box);
          if (parentInsDel) {
            this.splitUp(parentInsDel, box);
          }

          box.replaceWith(workBox);
          box = workBox;
        } else {
          box = workBox;
          this.result.appendChild(box);
        }
      } else {
        box = document.getElementById(`excluded-${id}`);
        if (box) {
          box.id = "";
          box.innerHTML = HTML;
        } else {
          box = document.createElement("div");
          box.innerHTML = HTML;
          this.result.appendChild(box);
        }
      }
      let fixupResult = this.fixupExcluded(type, box);
      this.fixupLink(type, box);
      this.fixupImages(type, box);
      if (sections.size > 1) {
        this.addSingleSectionButtons(box);
      }

      if (!fixupResult) {
        await this.loadFullDiff();
        this.createSecMap();
        this.fixupExcluded(type, box);
      }
    }

    this.setStat("");

    this.processing = false;
  }

  async createDiff(box, fromHTML, toHTML) {
    const workBoxFrom = document.createElement("div");
    this.workBoxContainer.appendChild(workBoxFrom);
    const workBoxTo = document.createElement("div");
    this.workBoxContainer.appendChild(workBoxTo);

    if (fromHTML !== null) {
      workBoxFrom.innerHTML = fromHTML;
      ListMarkUtils.textify(workBoxFrom);
      this.removeExcludedContent(workBoxFrom);
    }

    if (toHTML !== null) {
      workBoxTo.innerHTML = toHTML;
      ListMarkUtils.textify(workBoxTo);
      this.removeExcludedContent(workBoxTo);
    }

    if (!this.pathDiff.checked) {
      await new HTMLTreeDiff().diff(box, workBoxFrom, workBoxTo);
    } else {
      fromHTML = workBoxFrom.innerHTML;
      toHTML = workBoxTo.innerHTML;

      box.innerHTML = await HTMLPathDiff.diff(fromHTML, toHTML);
    }

    workBoxFrom.remove();
    workBoxTo.remove();
  }

  removeExcludedContent(box) {
    for (const div of [...box.getElementsByTagName("div")]) {
      if (div.id && div.id.startsWith("excluded-")) {
        div.textContent = "";
      }
    }
  }

  findParentInsDel(node) {
    while (node && node !== this.result) {
      if (node.classList.contains("htmldiff-change")) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }

  splitUp(ancestor, node) {
    while (node) {
      const last = node.parentNode === ancestor;

      while (node.previousSibling &&
             node.previousSibling.nodeType === Node.TEXT_NODE &&
             /^\s*$/.test(node.previousSibling.textContent)) {
        node.previousSibling.remove();
      }

      while (node.nextSibling &&
             node.nextSibling.nodeType === Node.TEXT_NODE &&
             /^\s*$/.test(node.nextSibling.textContent)) {
        node.nextSibling.remove();
      }

      const parent = node.parentNode;
      if (node === parent.firstChild) {
        parent.before(node);
      } else if (node === parent.firstChild) {
        parent.after(node);
      } else {
        const clonedParent = parent.cloneNode(false);
        parent.after(clonedParent);
        while (node.nextSibling) {
          clonedParent.appendChild(node.nextSibling);
        }
        parent.after(node);
      }

      if (last) {
        break;
      }
    }
  }

  fixupExcluded(type, box) {
    let result = true;

    const fixup = (node, id) => {
      if (type === "diff") {
        if (id in this.toSecData.map &&
            id in this.fromSecData.map &&
            this.fromSecData.map[id] !== this.toSecData.map[id]) {
          const del = document.createElement("del");
          del.classList.add("htmldiff-del");
          del.classList.add("htmldiff-change");
          del.textContent = this.fromSecData.map[id];

          const ins = document.createElement("ins");
          ins.classList.add("htmldiff-ins");
          ins.classList.add("htmldiff-change");
          ins.textContent = this.toSecData.map[id];

          node.textContent = "";
          node.appendChild(del);
          node.appendChild(ins);

          return true;
        }

        if (id in this.toSecData.map) {
          node.textContent = this.toSecData.map[id];
        } else if (id in this.fromSecData.map) {
          node.textContent = this.fromSecData.map[id];
        } else {
          return false;
        }
        return true;
      }

      if (type === "from") {
        if (id in this.fromSecData.map) {
          node.textContent = this.fromSecData.map[id];
        } else {
          return false;
        }
      } else {
        if (id in this.toSecData.map) {
          node.textContent = this.toSecData.map[id];
        } else {
          return false;
        }
      }

      return true;
    };

    const nums = box.getElementsByClassName("excluded-secnum");
    for (const node of [...nums]) {
      const id = node.getAttribute("excluded-id");
      if (fixup(node, id)) {
        node.classList.remove("excluded-secnum");
        node.removeAttribute("excluded-id");
      } else {
        result = false;
      }
    }

    const caps = box.getElementsByClassName("excluded-caption-num");
    for (const node of [...caps]) {
      const id = node.getAttribute("excluded-id");
      if (fixup(node, id)) {
        node.classList.remove("excluded-caption-num");
        node.removeAttribute("excluded-id");
      } else {
        result = false;
      }
    }

    const refs = box.getElementsByClassName("excluded-xref");
    for (const node of [...refs]) {
      const id = node.getAttribute("excluded-id");
      if (fixup(node, id)) {
        node.classList.remove("excluded-xref");
        node.removeAttribute("excluded-id");
      } else {
        result = false;
      }
    }

    return result;
  }

  // Replace links into the same document to links into snapshot.
  fixupLink(type, box) {
    const fromSnapshot = `./history/${this.fromRev.value}/index.html`;
    const toSnapshot = `./history/${this.toRev.value}/index.html`;

    const links = box.getElementsByTagName("a");
    for (const link of links) {
      if (!link.hasAttribute("href")) {
        continue;
      }
      const href = link.getAttribute("href");
      if (!href.startsWith("#")) {
        continue;
      }
      if (type === "from") {
        link.href = `${fromSnapshot}${href}`;
      } else if (type === "to") {
        link.href = `${toSnapshot}${href}`;
      } else {
        link.href = `${toSnapshot}${href}`;
      }
    }
  }

  fixupImages(type, box) {
    const fromSnapshotBase = `./history/${this.fromRev.value}/`;
    const toSnapshotBase = `./history/${this.toRev.value}/`;

    const imgs = box.getElementsByTagName("img");
    for (const img of imgs) {
      if (!img.hasAttribute("src")) {
        continue;
      }
      const src = img.getAttribute("src");

      if (src.startsWith("http") || src.startsWith("./history")) {
        continue;
      }

      if (type === "from") {
        img.src = `${fromSnapshotBase}${src}`;
      } else if (type === "to") {
        img.src = `${toSnapshotBase}${src}`;
      } else {
        img.src = `${toSnapshotBase}${src}`;
      }
    }

    const objs = box.getElementsByTagName("object");
    for (const obj of objs) {
      if (!obj.hasAttribute("data")) {
        continue;
      }
      const data = obj.getAttribute("data");

      if (data.startsWith("http") || data.startsWith("./history")) {
        continue;
      }

      if (type === "from") {
        obj.data = `${fromSnapshotBase}${data}`;
      } else if (type === "to") {
        obj.data = `${toSnapshotBase}${data}`;
      } else {
        obj.data = `${toSnapshotBase}${data}`;
      }
    }
  }

  // Add button to show single section.
  addSingleSectionButtons(box) {
    const clauses = box.getElementsByTagName("emu-clause");
    const annex = box.getElementsByTagName("emu-annex");
    const sections = [...clauses, ...annex];

    for (const section of sections) {
      const id = section.id;
      if (!id) {
        continue;
      }

      const h1s = section.getElementsByTagName("h1");
      if (h1s.length === 0) {
        continue;
      }

      const h1 = h1s[0];

      if (h1.getElementsByClassName("single-section-button").length > 0) {
        continue;
      }

      const button = document.createElement("button");
      button.classList.add("single-section-button");
      button.classList.add("round-button");
      button.textContent = "show single section";
      button.addEventListener("click", () => {
        window.scrollTo({
          left: 0,
          top: 0,
        });
        this.secList.value = id;
        this.onSecListChange().catch(e => console.error(e));
      });

      h1.appendChild(button);
    }
  }

  async onPRFilterChange() {
    this.updateUI("pr", {
      pr: this.prFilter.value,
    });
  }

  async onRevFilterChange() {
    this.updateUI("rev", {
      rev: this.revFilter.value,
    });
  }

  async onFromRevChange() {
    this.updateUI("from-to", {
      rev: this.revFilter.value,
    });
  }

  async onToRevChange() {
    this.updateUI("from-to", {
      rev: this.revFilter.value,
    });
  }

  async onSecListChange() {
    this.updateURL();
    await this.compare();
  }

  async onTabChange() {
    await this.compare();
  }

  async onPathDiffChange() {
    await this.compare();
  }

  onScrollUpClick() {
    const rect = this.getFirstChangeRectAboveScreen();
    if (!rect) {
      return;
    }

    const bottom = rect.bottom + 100;

    this.highlightChanges(this.getChangesInsidePreviousScreen(bottom));

    const doc = document.documentElement;
    window.scrollBy({
      behavior: "smooth",
      left: 0,
      top: bottom - doc.clientHeight,
    });
  }

  onScrollDownClick() {
    const rect = this.getFirstChangeRectBelowScreen();
    if (!rect) {
      return;
    }

    const top = rect.top - 100;

    this.highlightChanges(this.getChangesInsideNextScreen(top));

    window.scrollBy({
      behavior: "smooth",
      left: 0,
      top,
    });
  }

  getFirstChangeRectAboveScreen() {
    let prevRect = null;

    const changes = this.result.getElementsByClassName("htmldiff-change");
    for (const change of changes) {
      const rect = change.getBoundingClientRect();
      if (rect.top >= 0) {
        return prevRect;
      }
      prevRect = rect;
    }

    return prevRect;
  }

  getFirstChangeRectBelowScreen() {
    const doc = document.documentElement;
    const height = doc.clientHeight;

    const changes = this.result.getElementsByClassName("htmldiff-change");
    for (const change of changes) {
      const rect = change.getBoundingClientRect();
      if (rect.bottom > height) {
        return rect;
      }
    }

    return null;
  }

  getChangesInsidePreviousScreen(bottom) {
    const doc = document.documentElement;
    const height = doc.clientHeight;
    const result = [];

    const changes = this.result.getElementsByClassName("htmldiff-change");
    for (const change of changes) {
      const rect = change.getBoundingClientRect();
      if (rect.top >= bottom - height && rect.bottom <= bottom) {
        result.push(change);
      }
    }

    return result;
  }

  getChangesInsideNextScreen(top) {
    const doc = document.documentElement;
    const height = doc.clientHeight;
    const result = [];

    const changes = this.result.getElementsByClassName("htmldiff-change");
    for (const change of changes) {
      const rect = change.getBoundingClientRect();
      if (rect.top >= top && rect.bottom <= top + height) {
        result.push(change);
      }
    }
    return result;
  }

  highlightChanges(changes) {
    for (const change of changes) {
      change.classList.add("htmldiff-highllight");
    }
    setTimeout(() => {
      for (const change of changes) {
        change.classList.remove("htmldiff-highllight");
      }
    }, 500);
  }

  async onSearchKeyDown(event) {
    if (event.key !== "Enter") {
      return;
    }

    const query = this.searchField.value.trim();

    // First, check PR number
    {
      const m = query.match(/^#?(\d+)/);
      if (m) {
        const prnum = parseInt(m[1]);
        for (const pr of this.prs) {
          if (pr.number === prnum) {
            this.prFilter.value = prnum;
            await this.onPRFilterChange();
            return;
          }
        }
      }
    }

    if (query in this.revsAndPRsMap) {
      const value = this.revsAndPRsMap[query];
      await this.onSelectSearchList(value);
      return;
    }

    // Check all substring match
    for (const { label, value } of this.revsAndPRs) {
      if (label.includes(query)) {
        await this.onSelectSearchList(value);
        return;
      }
    }
  }

  async onSelectSearchList(value) {
    if (value.startsWith("#")) {
      this.prFilter.value = value.slice(1);
      await this.onPRFilterChange();
    } else {
      this.revFilter.value = value;
      await onRevFilterChange();
    }
  }

  async onSearchInput() {
    const query = this.searchField.value.trim();
    if (query in this.revsAndPRsMap) {
      const value = this.revsAndPRsMap[query];
      await this.onSelectSearchList(value);
    }
  }

  async onMessageOverlayClick() {
    this.messageBox.textContent = "";
    this.messageOverlay.classList.remove("shown");
  }

  async onCollapseControlClick() {
    this.headerCollapsed = !this.headerCollapsed;
    this.updateHeader();
    this.updateURL(true);
  }

  async onSecSearchInput() {
    const query = this.secSearchField.value.trim();
    if (query in this.secDataMap) {
      this.secList.value = this.secDataMap[query];
      await this.onSecListChange();
    }
  }

  async onSecSearchKeyDown(event) {
    if (event.key !== "Enter") {
      return;
    }

    const query = this.secSearchField.value.trim();
    if (query in this.secDataMap) {
      this.secList.value = this.secDataMap[query];
      await this.onSecListChange();
    }
  }

  async onSecAllChange() {
    this.updateURL();
    await this.updateSectionList();
    await this.compare();
  }

  async onSecSubTreeChange() {
    this.updateURL();
    await this.compare();
  }

  async onPopState() {
    if (window.location.search === this.currentQuery) {
      return;
    }
    this.currentQuery = window.location.search;

    await this.parseQuery();
  }
}

let comparator;

/* exported onBodyLoad */
function onBodyLoad() {
  comparator = new Comparator();
  comparator.run().catch(e => console.error(e));
}

/* exported onPRFilterChange */
function onPRFilterChange() {
  comparator.onPRFilterChange().catch(e => console.error(e));
}

/* exported onRevFilterChange */
function onRevFilterChange() {
  comparator.onRevFilterChange().catch(e => console.error(e));
}

/* exported onFromRevChange */
function onFromRevChange() {
  comparator.onFromRevChange().catch(e => console.error(e));
}

/* exported onToRevChange */
function onToRevChange() {
  comparator.onToRevChange().catch(e => console.error(e));
}

/* exported onSecListChange */
function onSecListChange() {
  comparator.onSecListChange().catch(e => console.error(e));
}

/* exported onTabChange */
function onTabChange() {
  comparator.onTabChange().catch(e => console.error(e));
}

/* exported onPathDiffChange */
function onPathDiffChange() {
  comparator.onPathDiffChange().catch(e => console.error(e));
}

/* exported onScrollUpClick */
function onScrollUpClick() {
  comparator.onScrollUpClick();
}

/* exported onScrollDownClick */
function onScrollDownClick() {
  comparator.onScrollDownClick();
}

/* exported onSearchKeyDown */
function onSearchKeyDown(e) {
  comparator.onSearchKeyDown(e).catch(e => console.error(e));
  return false;
}

/* exported onSearchInput */
function onSearchInput() {
  comparator.onSearchInput().catch(e => console.error(e));
}

/* exported onMessageOverlayClick */
function onMessageOverlayClick() {
  comparator.onMessageOverlayClick().catch(e => console.error(e));
}

/* exported onCollapseControlClick */
function onCollapseControlClick() {
  comparator.onCollapseControlClick().catch(e => console.error(e));
}

/* exported onSecSearchInput */
function onSecSearchInput() {
  comparator.onSecSearchInput().catch(e => console.error(e));
}

/* exported onSecSearchKeyDown */
function onSecSearchKeyDown(event) {
  comparator.onSecSearchKeyDown(event).catch(e => console.error(e));
}

/* exported onSecAllChange */
function onSecAllChange() {
  comparator.onSecAllChange().catch(e => console.error(e));
}

/* exported onSecSubTreeChange */
function onSecSubTreeChange() {
  comparator.onSecSubTreeChange().catch(e => console.error(e));
}

window.addEventListener("popstate", () => {
  comparator.onPopState().catch(e => console.error(e));
});
