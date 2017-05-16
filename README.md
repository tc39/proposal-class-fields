# ESnext class features for JavaScript

Daniel Ehrenberg

This document proposes a combined vision for how two of the proposed class features could work together--[public fields](https://tc39.github.io/proposal-class-public-fields/) and [private fields](https://github.com/tc39/proposal-private-fields), drawing on the earlier [Orthogonal Classes](https://github.com/erights/Orthogonal-Classes) and [Class Evaluation Order](https://onedrive.live.com/view.aspx?resid=A7BBCE1FC8EE16DB!442046&app=PowerPoint&authkey=!AEeXmhZASk50KjA) proposals. It is written to be forward-compatible with the introduction of private methods and decorators, whose integration is explained in the [unified class features proposal](https://github.com/littledan/proposal-unified-class-features). Methods and accessors are defined in [METHODS.md](https://github.com/littledan/proposal-class-fields/blob/master/METHODS.md).

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

In the above example, you can see a field declared with the syntax `x = 0`. You can also declare a field without an initializer as `x`. By declaring fields up-front, class definitions become more self-documenting; instances go through fewer state transitions, as declared fields are always present.

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

Note that ESnext provides private fields only as declared up-front in a field declaration; private fields cannot be created as expandos.

## Details of this proposal

See the <a href="http://littledan.github.io/proposal-class-fields/">draft specification</a> for full details.

### Orthogonality

This proposal provides fields which are orthogonal on the following axes:
- Placement: Static vs instance
- Visibility/name: public vs private vs computed property name
- With or without initializer

The variety of forms is visible in this example:

```js
class C {
  static x = 1, #y, [a];
  z, #w = 2, [b];
}
```

Omitted from this proposal are private methods and accessors, private members of object literals, and decorators. These may be added in a later proposal, as detailed in the [unified class features proposal](https://github.com/littledan/proposal-unified-class-features).

## Changes vs previous proposals

- Omitting concise syntax: When working out how code would evolve in some simple examples, it became clear that it's confusing that you're supposed to omit `this.` when turning a field from public to private, rather than just adding a `#` at the beginning of the name. For that reason, they are omitted from this proposal. However, the `.#` syntax is retained, which would be consistent with adding that shorthand later if we change our minds.
- Comma-separated multiple definitions: These are visible in the above example of `class C`, and are analogous to comma-separated definitions from `var`, `let` and `const`. They may be immediately useful when declaring multiple `static` fields, but later are useful in conjuction with decorators.
- Private static fields: These just fall out naturally "from the grid" when combining the proposals. It would've taken special spec text to specifically block them.
