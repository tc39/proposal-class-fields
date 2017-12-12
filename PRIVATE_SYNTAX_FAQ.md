## Why aren't declarations `private x`?

This sort of declaration is what other languages use (notably Java), and implies that access would be done with `this.x`. Assuming that isn't the case (see below), in JavaScript this would silently create or access a public field, rather than throwing an error. This is a major potential source of bugs or invisibly making public fields which were intended to be private.

## Why isn't access `this.x`?

Having a private field named `x` must not prevent there from being a public field named `x`, so accessing a private field can't just be a normal lookup.

Less significantly, this would also break an invariant of current syntax: `this.x` and `this['x']` are currently always semantically identical.

### Why does this proposal allow a class to have a private field `#x` *and* a public field `x`?

1. If private fields conflicted with public fields, it would break encapsulation; see below.

1. One of the more important properties of private fields is that subclasses don't need to know about them. We'd like to allow a subclass to define a property named `x` even if its superclass has a private field of that name.

This is something other languages with private fields generally allow. E.g., the following is perfectly legal Java:

```java
class Base {
  private int x = 0;
}

class Derived extends Base {
  public int x = 0;
}
```

### Why not do a runtime check on the type of the receiver to determine whether to access the private or public field named `x`?

Property access semantics are already complicated, and we don't want to slow down every property access just to add this feature.

It also would allow methods of the class to be tricked into operating on public fields of non-instances as if they were private fields of instances. See [this comment](https://github.com/tc39/proposal-private-fields/issues/14#issuecomment-153050837) for an example.

### Why not just always have `obj.x` refer to a private field inside of a class which declares a private field `x`?

Class methods often manipulate objects which are not instances of the class. It would be surprising if the code `obj.x` suddenly stopped referring to public field `x` of `obj`, when `obj` is not expected to be an instance of the class, just because that code happened to occur somewhere within a class which declares a private field named `x`, possibly deep within said class.

This is only an issue in JavaScript because of its lack of static types. Statically typed languages use type declarations to distinguish the external-public/internal-private cases without the need of a sigil. But a dynamically typed language doesn't have enough static information to differentiate those cases.

### Why not give the `this` keyword special semantics?

`this` is already a source of enough confusion in JS; we'd prefer not to make it worse. Also, it's a major refactoring hazard: it would be surprising if `this.x` had different semantics from `const thiz = this; thiz.x`.

This also wouldn't allow accessing fields of objects other than `this`.

### Why not only allow accessing fields of `this`, e.g. by just having a bare `x` refer to the private field `x`?

It is a goal of this proposal to allow accessing private fields of other instances of the same class (see below), which requires some syntax. Also, using bare identifiers to refer to properties is not the usual JS way (with the exception of `with`, which is generally considered to have been a mistake).

### Why doesn't `this['#x']` access the private field named `#x`, given that `this.#x` does?

1. This would complicate property access semantics.

1. Dynamic access to private fields is contrary to the notion of 'private'. E.g. this is concerning:

```js
class Dict extends null {
  #data = something_secret;
  add(key, value) {
    this[key] = value;
  }
  get(key) {
    return this[key];
  }
}

(new Dict).get('#data'); // returns something_secret
```

#### But doesn't giving `this.#x` and `this['#x']` different semantics break an invariant of current syntax?

Not exactly, but it is a concern. `this.#x` has never previously been legal syntax, so from one point of view there can be no invariant regarding it.

On the other hand, it might be surprising that they differ, and this is a downside of the current proposal.

## Why not have access be `this#x`, without the dot?

It's an [ASI hazard](https://github.com/tc39/proposal-private-fields/issues/39#issuecomment-237121552), given the shorthand syntax of `#x` to mean `this.#x`.

## Why does this proposal allow accessing private fields of other instances of the same class? Don't other languages normally forbid that?

It's very useful: see e.g. the `equals` method in the `Point` example in the readme. And in fact, [other languages](https://github.com/tc39/proposal-private-fields/issues/90#issuecomment-307201358) allow it for the same reason; e.g. the following is perfectly legal Java:

```java
class Point {
	private int x = 0;
	private int y = 0;
	public boolean equals(Point p) { return this.x == p.x && this.y == p.y; }
}
```
## Why was the sigil `#` chosen, among all the Unicode code points?

No one came out and said, `#` is the most beautiful, intuitive thing to indicate private state. Instead, it was more of a process of elimination:
- `@` was the initial favorite, but it was taken by decorators. TC39 considered swapping decorators and private state sigils, but the committee decided to defer to the existing usage of transpiler users.
- `_` would cause compatibility issues with existing JavaScript code, which has allowed `_` at the start of an identifier or (public) property name for a long time.
- Other characters which could be used as infix operators, but not prefix operators, are hypothetically possible, such as `%`, `^`, `&`, `?`, given that our syntax is a bit unique--`x.%y` is not valid currently, so there would be no ambiguity. However, the shorthand would lead to ASI issues, e.g., the following would look like using the infix operator:
```js
class Foo {
  %x;
  method() {
    calculate().my().value()
    %x.print()
  }
}
```
Here, the user likely intended to call the `print` method on `this.%x`, but instead, the mod operator will be used!
- Other Unicode code points which are not in ASCII or IDStart could be used, but these might be hard to input for many users; they are not found on common keyboards.

In the end, the only other options are longer sequences of punctuation, which seems suboptimal compared to a single character.

## Why doesn't this proposal allow some mechanism for reflecting on / accessing private fields from outside the class which declares them (e.g. for testing)? Don't other languages normally allow that?

Doing so would violate encapsulation (see below). That other languages allow it isn't sufficient reason on its own, especially since in some of them (e.g. C++) this is accomplished by modifying memory directly and is not necessarily a goal.

## What do you mean by "encapsulation" / "hard private"?

It means that private fields are *purely* internal: no JS code outside of a class can detect or affect the existence, name, or value of any private field of instances of said class without directly inspecting the class's source, unless the class chooses to reveal them. (This includes subclasses and superclasses.)

This means that reflection methods like [getOwnPropertySymbols](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/getOwnPropertySymbols) must not reveal private fields.

This also means that if a class has a private field named `x`, code outside the class which does `obj.x` on an instance `obj` of the class should access the public field `x` just as it would in the absence of the private field. It must *not* access the private field or throw an error. Note that this doesn't come up as much in languages like Java, which can be type-checked at compile time and do not allow dynamic access to fields by name except via reflection APIs.

## Why is encapsulation a goal of this proposal?

1. Library authors have found that their users will start to depend on any exposed part of their interface, even undocumented parts. They do not generally consider themselves free to break their user's pages and applications just because those users were depending upon some part of the library's interface which the library author did not intend them to depend upon. As a consequence, they would like to have hard private state to be able to hide implementation details in a more complete way.

1. While it's already possible to *model* true encapsulation using either per-instance closures or WeakMaps (see below), both approaches are unergonomic to use with classes and have memory usage semantics which may be surprising. Furthermore, per-instance closures don't allow instances of the same class to access each other's private fields (see [above](#why-does-this-proposal-allow-accessing-private-fields-of-other-instances-of-the-same-class-dont-other-languages-normally-forbid-that)), and with WeakMaps there's a non-obvious risk of exposing private data. WeakMaps are also likely to be slower than private fields could be.

1. "Hidden" but not encapsulated properties are likewise already possible through the use of Symbols as property names (see below).

This proposal is currently moving forward with hard-private fields, letting [decorators](https://github.com/tc39/proposal-private-fields/blob/master/DECORATORS.md) or other mechanisms provide classes an opt-in escape hatch. We intend to gather feedback during this process to help determine whether this is the correct semantics.

See [this issue](https://github.com/tc39/proposal-private-fields/issues/33) for more.

### How can you model encapsulation using WeakMaps?

```js
const Person = (function(){
  const privates = new WeakMap;
  let ids = 0;
  return class Person {
    constructor(name) {
      this.name = name;
      privates.set(this, {id: ids++});
    }
    equals(otherPerson) {
      return privates.get(this).id === privates.get(otherPerson).id;
    }
  }
})();
let alice = new Person('Alice');
let bob = new Person('Bob');
alice.equals(bob); // false
```

There's a potential pitfall with this approach, though. Suppose we want to add a custom callback to construct greetings:

```js
const Person = (function(){
  const privates = new WeakMap;
  let ids = 0;
  return class Person {
    constructor(name, makeGreeting) {
      this.name = name;
      privates.set(this, {id: ids++, makeGreeting});
    }
    equals(otherPerson) {
      return privates.get(this).id === privates.get(otherPerson).id;
    }
    greet(otherPerson) {
      return privates.get(this).makeGreeting(otherPerson.name);
    }
  }
})();
let alice = new Person('Alice', name => `Hello, ${name}!`);
let bob = new Person('Bob', name => `Hi, ${name}.`);
alice.equals(bob); // false
alice.greet(bob); // === 'Hello, Bob!'
```

At first glance this appears fine, but:

```js
let mallory = new Person('Mallory', function(name) {this.id = 0; return `o/ ${name}`;});
mallory.greet(bob); // === 'o/ Bob'
mallory.equals(alice); // true. Oops!
```

### How can you provide hidden but not encapsulated properties using Symbols?

```js
const Person = (function(){
  const _id = Symbol('id');
  let ids = 0;
  return class Person {
    constructor(name) {
      this.name = name;
      this[_id] = ids++;
    }
    equals(otherPerson) {
      return this[_id] === otherPerson[_id];
    }
  }
})();
let alice = new Person('Alice');
let bob = new Person('Bob');
alice.equals(bob); // false

alice[Object.getOwnPropertySymbols(alice)[0]]; // == 0, which is alice's id.
```
