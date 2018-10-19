# Class field declarations for JavaScript

Daniel Ehrenberg, Jeff Morrison

Stage 3

This document proposes a combined vision for [public fields](https://tc39.github.io/proposal-class-public-fields/) and [private fields](https://github.com/tc39/proposal-private-fields), drawing on the earlier [Orthogonal Classes](https://github.com/erights/Orthogonal-Classes) and [Class Evaluation Order](https://onedrive.live.com/view.aspx?resid=A7BBCE1FC8EE16DB!442046&app=PowerPoint&authkey=!AEeXmhZASk50KjA) proposals. It is written to be forward-compatible with the introduction of private methods and decorators, whose integration is explained in the [unified class features proposal](https://github.com/littledan/proposal-decorators). Methods and accessors are defined in [a follow-on proposal](https://github.com/littledan/proposal-private-methods/).

## A guiding example: Custom elements with classes

To define a counter widget which increments when clicked, you can define the following with ES2015:

```js
class Counter extends HTMLElement {
  clicked() {
    this.x++;
    window.requestAnimationFrame(this.render.bind(this));
  }

  constructor() {
    super();
    this.onclick = this.clicked.bind(this);
    this.x = 0;
  }

  connectedCallback() { this.render(); }

  render() {
    this.textContent = this.x.toString();
  }
}
window.customElements.define('num-counter', Counter);
```

## Field declarations

With the ESnext field declarations proposal, the above example can be written as


```js
class Counter extends HTMLElement {
  x = 0;

  clicked() {
    this.x++;
    window.requestAnimationFrame(this.render.bind(this));
  }

  constructor() {
    super();
    this.onclick = this.clicked.bind(this);
  }

  connectedCallback() { this.render(); }

  render() {
    this.textContent = this.x.toString();
  }
}
window.customElements.define('num-counter', Counter);
```

In the above example, you can see a field declared with the syntax `x = 0;`. You can also declare a field without an initializer as `x;`. By declaring fields up-front, class definitions become more self-documenting; instances go through fewer state transitions, as declared fields are always present.

## Private fields

The above example has some implementation details exposed to the world that might be better kept internal. Using ESnext private fields and methods, the definition can be refined to:

```js
class Counter extends HTMLElement {
  #x = 0;

  clicked() {
    this.#x++;
    window.requestAnimationFrame(this.render.bind(this));
  }

  constructor() {
    super();
    this.onclick = this.clicked.bind(this);
  }

  connectedCallback() { this.render(); }

  render() {
    this.textContent = this.#x.toString();
  }
}
window.customElements.define('num-counter', Counter);
```

To make fields private, just give them a name starting with `#`.

By defining things which are not visible outside of the class, ESnext provides stronger encapsulation, ensuring that your classes' users don't accidentally trip themselves up by depending on internals, which may change version to version.

Note that ESnext provides private fields only as declared up-front in a field declaration; private fields cannot be created later, ad-hoc, through assigning to them, the way that normal properties can.

## Details of this proposal

See the [draft specification](https://tc39.github.io/proposal-class-fields/) for full details.

For the rational for the syntax used for private fields, see the [relevant FAQ](PRIVATE_SYNTAX_FAQ.md).

### Orthogonality

This proposal provides fields which are orthogonal on the following axes:
- Placement: Static vs instance -- static postponed to [follow-on proposal](https://github.com/tc39/proposal-static-class-features/)
- Visibility/name: public vs private vs computed property name
- With or without initializer

The variety of forms is visible in this example:

```js
class C {
  z;
  #w = 2;
  [b];
}
```

Omitted from this proposal are private methods and accessors, private members of object literals, and decorators. These may be added in a later proposal, as detailed in the [unified class features proposal](https://github.com/littledan/proposal-unified-class-features).

## Changes vs previous proposals

- Comma-separated multiple definitions: These are visible in the above example of `class C`, and are analogous to comma-separated definitions from `var`, `let` and `const`. They may be immediately useful when declaring multiple `static` fields, but later are useful in conjuction with decorators.
- Private static fields: These just fall out naturally "from the grid" when combining the proposals. It would've taken special spec text to specifically block them.


## Status

### Consensus in TC39

This proposal reached [Stage 3](https://tc39.github.io/process-document/) in July 2017. Since that time, there has been extensive thought and lengthy discussion about various alternatives, including:
- [JS Classes 1.1](https://github.com/zenparsing/js-classes-1.1)
- [Reconsideration of "static private"](https://github.com/tc39/proposal-static-class-features)
- [Additional use of the `private` keyword](https://gist.github.com/rauschma/a4729faa65b30a6fda46a5799016458a)
- [Private Symbols](https://github.com/zenparsing/proposal-private-symbols)

In considering each proposal, TC39 delegates looked deeply into the motivation, JS developer feedback, and the implications on the future of the language design. In the end, this thought process and continued community engagement led to renewed consensus on the proposal in this repository. Based on that consensus, implementations are moving forward on this proposal.

### Implementations

You can experiment with the class fields proposal using the following complete implementations:

- Babel [7.0+](https://babeljs.io/blog/2018/08/27/7.0.0#tc39-proposals-https-githubcom-tc39-proposals-support)
- [Behind a flag](https://www.chromestatus.com/feature/6001727933251584) in Chrome/V8

Further implementations are on the way:

- [In progress](https://github.com/bloomberg/TypeScript/pull/6) in TypeScript
- [Out for review](https://bugs.webkit.org/show_bug.cgi?id=174212) in Safari/JSC
- Planned in Firefox/SpiderMonkey
- [Additional tooling support](https://github.com/tc39/proposal-class-fields/issues/57)

### Activity welcome in this repository

You are encouraged to file issues and PRs this repository to
- Ask questions about the proposal, how the syntax works, what the semantics mean, etc.
- Propose and discuss small syntactic or semantic tweaks, especially those motivated by experience implementing or using the proposal.
- Develop improved documentation, sample code, and other ways to introduce programmers at all levels to this feature.

If you have any additional ideas on how to improve JavaScript, see ecma262's [CONTRIBUTING.md](https://github.com/tc39/ecma262/blob/master/CONTRIBUTING.md) for how to get involved.
