# Private methods and accessors

This document builds on [README.md](https://github.com/littledan/proposal-class-fields) by adding private methods.

## Continuing the example

We could declare the `clicked` method as private by giving it a name starting with `#`, as follows:

```js
class Counter extends HTMLElement {
  #x = 0;

  #clicked() {
    this.#x++;
    window.requestAnimationFrame(this.render.bind(this));
  }

  constructor() {
    super();
    this.onclick = #clicked.bind(this);
  }

  connectedCallback() { this.render(); }

  render() {
    this.textContent = #x.toString();
  }
}
window.customElements.define('num-counter', Counter);
```

By defining things which are not visible outside of the class, ESnext provides stronger encapsulation, ensuring that your classes' users don't accidentally trip themselves up by depending on internals, which may change version to version.

Note that private methods must be defined within the class body and cannot be added to the prototype later. You can also define private getters and setters similarly.

## Details of this proposal

See the <a href="http://littledan.github.io/proposal-class-fields/private-methods.html">draft specification</a> for full details.

Private methods and accessors are, in effect, immutable lexically scoped functions. They are represented in the specification as internal slots on the private name, which put it in one of three states:

- Field, meaning when `x.#y` is seen, `#y` is looked up within the list of private fields of `x`.
- Method, meaning when `x.#y` evaluates to a the method declared as `#y` (which can then be called).
- Accessor, meaning that `x.#y` will invoke a declared getter function, or setter if it is written to.

The particular method or getter/setter pair is stored as an internal slot on the private name as well. Once these slots are filled in by the class declaration, they cannot be changed later.
