# Class field declarations for JavaScript

Daniel Ehrenberg, Jeff Morrison

[Stage 4](https://tc39.es/process-document/)

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

Note that ESnext provides private fields only as declared up-front in a field declaration; private fields cannot be created later, ad-hoc, through assigning to them, the way that normal properties can.


## Major design points

### Public fields created with Object.defineProperty

A public field declarations define fields on instances with the internals of `Object.defineProperty` (which we refer to in TC39 jargon as `[[Define]]` semantics), rather than with `this.field = value;` (referred to as `[[Set]]` semantics). Here's an example of the impact:

```js
class A {
  set x(value) { console.log(value); }
}
class B extends A {
  x = 1;
}
```

With the adopted semantics, `new B()` will result in an object which has a property `x` with the value `1`, and nothing will be written to the console. With the alternate `[[Set]]` semantics, `1` would be written to the console, and attempts to access the property would lead to a `TypeError` (because the getter is missing).

The choice between `[[Set]]` and `[[Define]]` is a design decision contrasting different kinds of expectations of behavior: Expectations that the field will be created as a data property regardless of what the superclass contains, vs expectations that the setter would be called. Following a lengthy discussion, TC39 settled on `[[Define]]` semantics, finding that it's important to preserve the first expectation.

The decision to base public field semantics on `Object.defineProperty` was based on extensive discussion within TC39 and consultation with the developer community. Unfortunately, [the community was rather split](https://github.com/tc39/proposal-class-fields/issues/151#issuecomment-431597270), while TC39 came down rather strongly on the side of `Object.defineProperty`.

As a mitigation, the [decorators proposal](https://github.com/tc39/proposal-decorators/) provides the tools to write a decorator to make a public field declaration use `[[Set]]` semantics. Even if you disagree with the default, the other option is available. (This would be the case regardless of which default TC39 chose.)

Public fields are [shipping](https://www.chromestatus.com/feature/6001727933251584) in Chrome 72 with `[[Define]]` semantics, and this decision on semantics is unlikely to be revisited.

### Fields without initializers are set to `undefined`

Both public and private field declarations create a field in the instance, whether or not there's an initializer present. If there's no initializer, the field is set to `undefined`. This differs a bit from certain transpiler implementations, which would just entirely ignore a field declaration which has no initializer.

For example, in the following example, `new D` would result in an object whose `y` property is `undefined`, not `1`.

```js
class C {
  y = 1;
}
class D extends C {
  y;
}
```

The semantics of setting fields without initializers to `undefined` as opposed to erasing them is that field declarations give a reliable basis to ensure that properties are present on objects that are created. This helps programmers keep objects in the same general state, which can make it easy to reason about and, sometimes, more optimizable in implementations.

### Private syntax

Private fields are based on syntax using a `#`, both when declaring a field and when accessing it.

```js
class X {
  #foo;
  method() {
    console.log(this.#foo)
  }
}
```

This syntax tries to be both terse and intuitive, although it's rather different from other programming languages. See [the private syntax FAQ](https://github.com/tc39/proposal-class-fields/blob/master/PRIVATE_SYNTAX_FAQ.md) for discussion of alternatives considered and the constraints that led to this syntax.

There are no private computed property names: `#foo` is a private identifier, and `#[foo]` is a syntax error.

### No backdoor to access private

Private fields provide a strong encapsulation boundary: It's impossible to access the private field from outside of the class, unless there is some explicit code to expose it (for example, providing a getter). This differs from JavaScript properties, which support various kinds of reflection and metaprogramming, and is instead analogous to mechanisms like closures and `WeakMap`, which don't provide access to their internals. See [these FAQ entries](https://github.com/tc39/proposal-class-fields/blob/master/PRIVATE_SYNTAX_FAQ.md#why-doesnt-this-proposal-allow-some-mechanism-for-reflecting-on--accessing-private-fields-from-outside-the-class-which-declares-them-eg-for-testing-dont-other-languages-normally-allow-that) for more information on the motivation for this decision.

Some mitigations which make it easier to access
- Implementations' developer tools may provide access to private fields ([V8 issue](https://bugs.chromium.org/p/v8/issues/detail?id=8337)).
- The [decorators proposal](https://github.com/tc39/proposal-decorators/) gives tools for easy-to-use and controlled access to private fields.

### Execution of initializer expressions

Public and private fields are each added to the instance in the order of their declarations, while the constructor is running. The initializer is newly evaluated for each class instance. Fields are added to the instance right after the initializer runs, and before evaluating the following initializer.

**Scope**: The instance under construction is in scope as the `this` value inside the initializer expression. `new.target` is undefined, as in methods. References to `arguments` are an early error. Super method calls `super.method()` are available within initializers, but super constructor calls `super()` are a syntax error. `await` and `yield` are unavailable in initializers, even if the class is declared inside an async function/generator.

When field initializers are evaluated and fields are added to instances:
- **Base class**: At the beginning of the constructor execution, even before parameter destructuring.
- **Derived class**: Right after `super()` returns. (The flexibility in how `super()` can be called has led many implementations to make a separate invisible `initialize()` method for this case.)

If `super()` is not called in a derived class, and instead some other  public and private fields are not added to the instance, and initializers are not evaluated. For base classes, initializers are always evaluated, even if the constructor ends up returning something else. The [`new.initialize`](https://github.com/littledan/proposal-new-initialize) proposal would add a way to programmatically add fields to an instance which doesn't come from `super()`/the `this` value in the base class.

## Specification

See the [draft specification](https://tc39.github.io/proposal-class-fields/) for full details.

## Status

### Consensus in TC39

This proposal reached [Stage 3](https://tc39.github.io/process-document/) in July 2017. Since that time, there has been extensive thought and lengthy discussion about various alternatives, including:
- [JS Classes 1.1](https://github.com/zenparsing/js-classes-1.1)
- [Reconsideration of "static private"](https://github.com/tc39/proposal-static-class-features)
- [Additional use of the `private` keyword](https://gist.github.com/rauschma/a4729faa65b30a6fda46a5799016458a)
- [Private Symbols](https://github.com/zenparsing/proposal-private-symbols)

In considering each proposal, TC39 delegates looked deeply into the motivation, JS developer feedback, and the implications on the future of the language design. In the end, this thought process and continued community engagement led to renewed consensus on the proposal in this repository. Based on that consensus, implementations are moving forward on this proposal.

### Development history

This document proposes a combined vision for [public fields](https://tc39.github.io/proposal-class-public-fields/) and [private fields](https://github.com/tc39/proposal-private-fields), drawing on the earlier [Orthogonal Classes](https://github.com/erights/Orthogonal-Classes) and [Class Evaluation Order](https://onedrive.live.com/view.aspx?resid=A7BBCE1FC8EE16DB!442046&app=PowerPoint&authkey=!AEeXmhZASk50KjA) proposals. It is written to be forward-compatible with the introduction of private methods and decorators, whose integration is explained in the [unified class features proposal](https://github.com/littledan/proposal-decorators). Methods and accessors are defined in [a follow-on proposal](https://github.com/littledan/proposal-private-methods/).

This proposal has been developed in this GitHub repository as well as in presentations and discussions in [TC39 meetings](https://github.com/tc39/ecma262/blob/master/CONTRIBUTING.md). See the past presentations and discussion notes below.

| Date           | Slides                                                                                                                                                        | Notes                                                                                                                                                         |
|----------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|
| July 2016      | [Private State](https://docs.google.com/presentation/d/1RM_DEWAYh8PmJRt02IunIRaUNjlwprXF3yPW6NltuMA/edit#slide=id.p)                                          | [📝](https://github.com/tc39/tc39-notes/blob/master/es7/2016-07/jul-28.md#9iiib-private-state)                                                                |
| January 2017   | [Public and private class fields: Where we are and next steps](https://docs.google.com/presentation/d/1yXsRdAJO7OdxF0NmZs2N8ySSrQwKp3D77vZXbQOWbMs/edit)      | [📝](https://github.com/tc39/tc39-notes/blob/master/es7/2017-01/jan-26.md#public-and-private-class-fields-daniel-ehrenberg-jeff-morrison-and-kevin-gibbons)   |
| May 2017       | [Class Fields Integrated Proposal](https://drive.google.com/file/d/0B-TAClBGyqSxWHpyYmg2UnRHc28/view)                                                         | [📝](https://github.com/tc39/tc39-notes/blob/master/es8/2017-05/may-25.md#15iiib-updates-on-class-field-proposals-both-public-and-private)                    |
| July 2017      | [Unified Class Features: A vision of orthogonality](https://docs.google.com/presentation/d/1GZ5Rfa4T7aF7t0xJrDxRZhC49mvqG5Nm6qZ_g_qrfBY/edit#slide=id.p)      | [📝](https://github.com/tc39/tc39-notes/blob/master/es8/2017-07/jul-27.md#11ivc-class-fields-for-stage-3)                                                     |
| September 2017 | [Class fields status update](https://docs.google.com/presentation/d/169hWHIKFnX8E-N90FJQS3u5xpo5Tt-s4IFdheLySVfQ/edit#slide=id.p)                             | [📝](https://github.com/tc39/tc39-notes/blob/master/es8/2017-09/sep-26.md#12ib-class-fields-status-update)                                                    |
| November 2017  | [Class fields, static and private](https://docs.google.com/presentation/d/1wgus0BykoVk_qqCpr0TjgO0TV0Y4ql4d9iY212phzbY/edit#slide=id.g2936c02723_0_63)        | [📝](https://github.com/tc39/tc39-notes/blob/master/es8/2017-11/nov-30.md#10iva-continued-inheriting-private-static-class-elements-discussion-and-resolution) |
| November 2017  | [Class features proposals: Instance features to stage 3](https://docs.google.com/presentation/d/1wKktzSOKnVIUAnfDHgTVOlQp-O3OBtHN4dKX8--DQvc/edit#slide=id.p) | [📝](https://github.com/tc39/tc39-notes/blob/master/es8/2017-11/nov-30.md#10iva-continued-inheriting-private-static-class-elements-discussion-and-resolution) |
| November 2017  | [ASI in class field declarations](https://docs.google.com/presentation/d/1bPzE6i_Bpm6FXgzfx9XFJNHGkVcM42lux-6bUNhxpl4/edit#slide=id.p)                        | [📝](https://github.com/tc39/tc39-notes/blob/master/es8/2017-11/nov-30.md#10ivf-class-fields-asi-discussion-and-resolution)                                   |
| May 2018       | [Class fields: Stage 3 status update](https://docs.google.com/presentation/d/1oDQOS9b8wnuP5-o8zInsEO9lpRbhduawAmvfRzbxkOs/edit?usp=sharing)                   | [📝](https://github.com/tc39/tc39-notes/blob/master/es9/2018-05/may-23.md#class-fields-status-update)                                                         |
| September 2018 | [Class fields and private methods: Stage 3 update](https://docs.google.com/presentation/d/1Q9upYkWnPjJaVc8k9q3U6NekDch8tsz7CgV-Xm55-5Y/edit#slide=id.p)       | [📝](https://github.com/tc39/tc39-notes/blob/master/es9/2018-09/sept-26.md#class-fields-and-private-methods-stage-3-update)                                   |
| January 2019   | [Private fields and methods refresher](https://docs.google.com/presentation/d/1lPEfTLk_9jjjcjJcx0IAKoaq10mv1XrTZ-pgERG5YoM/edit#slide=id.p) | [📝](https://github.com/tc39/tc39-notes/blob/master/meetings/2019-01/jan-30.md#private-fields-and-methods-refresher) |

### Implementations

You can experiment with the class fields proposal using the following implementations:

- Babel [7.0+](https://babeljs.io/blog/2018/08/27/7.0.0#tc39-proposals-https-githubcom-tc39-proposals-support)
- [Node 12](https://nodejs.org/en/blog/release/v12.0.0/)
- Chrome/V8
  - Public fields are [enabled](https://www.chromestatus.com/feature/6001727933251584) in Chrome 72 / V8 7.2
  - Private fields are [enabled](https://www.chromestatus.com/feature/6035156464828416) in Chrome 74 / V8 7.4
- Firefox/SpiderMonkey
  - Public instance fields are [enabled](https://wiki.developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/69#JavaScript) in Firefox 69
  - Public static fields are [enabled](https://wiki.developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/75#JavaScript) in Firefox 75
- Safari/JSC
  - Public instance fields are [enabled](https://developer.apple.com/documentation/safari-release-notes/safari-14-release-notes#JavaScript) in Safari 14
  - Public static fields are [enabled](https://webkit.org/blog/11364/release-notes-for-safari-technology-preview-117/) in Safari Technology Preview 117
  - Private fields are [enabled](https://webkit.org/blog/11364/release-notes-for-safari-technology-preview-117/) in Safari Technology Preview 117
- [Moddable XS](https://blog.moddable.com/blog/secureprivate/)
- [QuickJS](https://www.freelists.org/post/quickjs-devel/New-release,82)
- [TypeScript 3.8](https://devblogs.microsoft.com/typescript/announcing-typescript-3-8/#ecmascript-private-fields)

Further implementations are on the way:

- Firefox/SpiderMonkey: [Private instance fields](https://bugzilla.mozilla.org/show_bug.cgi?id=1562054)
- [Additional tooling support](https://github.com/tc39/proposal-class-fields/issues/57)

### Activity welcome in this repository

You are encouraged to file issues and PRs this repository to
- Ask questions about the proposal, how the syntax works, what the semantics mean, etc.
- Discuss implementation and testing experience, and issues that arise out of that process.
- Develop improved documentation, sample code, and other ways to introduce programmers at all levels to this feature.

If you have any additional ideas on how to improve JavaScript, see ecma262's [CONTRIBUTING.md](https://github.com/tc39/ecma262/blob/master/CONTRIBUTING.md) for how to get involved.
