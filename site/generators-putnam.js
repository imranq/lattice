// Putnam solutions as step problems: fill in the crucial step, or put the steps
// in order.
//
// Every correct step is a verbatim excerpt of the published solution (Kedlaya's
// Putnam archive), so the answer key is the source's own order — never anyone's
// judgement. scripts/verify_generators.mjs checks each excerpt against the
// solution text, and checks that no wrong option appears anywhere in it.
//
// Wrong options come from four places, mixed per problem:
//   written    a plausible move that fails, with the reason (below, per problem)
//   misplaced  a later step of the same proof, which depends on the missing one
//   mutated    the right step with one word flipped (≤/≥, even/odd, …)
//   foreign    a step from another problem (the lowest level only: easy to spot)
(function () {
  "use strict";
  const M = (typeof self !== "undefined" ? self : this).MathGen;
  if (!M) return;
  const { band } = M.util;

  const SOURCE = {
    book: "putnam", title: "Putnam archive (Kedlaya)", section: "solutions",
    url: "https://kskedlaya.org/putnam-archive/", fidelity: "faithful",
  };

  // `after`: the steps a step needs; omitted means "the step before it".
  // `crucial`: the step that a fill-in question blanks out.
  const PROBLEMS = [
    {
      id: "1995-B1", crucial: "s2",
      statement: "For a partition $\\pi$ of $\\{1, 2, \\ldots, 9\\}$, let $\\pi(x)$ be the number of elements in the part containing $x$. Prove that for any two partitions $\\pi$ and $\\pi'$, there are two distinct numbers $x$ and $y$ with $\\pi(x) = \\pi(y)$ and $\\pi'(x) = \\pi'(y)$.",
      steps: [
        { id: "s1", ex: "For a given $\\pi$, no more than three different values of $\\pi(x)$ are possible (four would require one part each of size at least 1,2,3,4, and that's already more than 9 elements).", after: [] },
        { id: "s2", ex: "If no such $x, y$ exist, each pair $(\\pi(x), \\pi'(x))$ occurs for at most 1 element of $x$, and since there are only $3 \\times 3$ possible pairs, each must occur exactly once.", after: ["s1"] },
        { id: "s3", ex: "In particular, each value of $\\pi(x)$ must occur 3 times.", after: ["s2"] },
        { id: "s4", ex: "However, clearly any given value of $\\pi(x)$ occurs $k\\pi(x)$ times, where $k$ is the number of distinct partitions of that size.", after: [] },
        { id: "s5", ex: "Thus $\\pi(x)$ can occur 3 times only if it equals 1 or 3, but we have three distinct values for which it occurs, contradiction.", after: ["s3", "s4"] },
      ],
      wrong: [
        { text: "If no such $x, y$ exist, then $\\pi = \\pi'$, since two partitions of 9 elements with the same part sizes must coincide.", why: "Equal part sizes don't make two partitions equal; the proof counts pairs of values instead." },
        { text: "Since there are 9 elements and at most 3 values of $\\pi(x)$, some value of $\\pi(x)$ occurs at least 3 times, and two of those elements give the required $x, y$.", why: "Three elements sharing a value of π needn't share a value of π′: that is exactly what has to be shown." },
      ],
    },
    {
      id: "1996-A1", crucial: "s3",
      statement: "Find the least number $A$ such that for any two squares of combined area 1, a rectangle of area $A$ exists into which the two squares can be packed without overlap (sides parallel to the rectangle's sides).",
      steps: [
        { id: "s1", ex: "If $x$ and $y$ are the sides of two squares with combined area 1, then $x^2 + y^2 = 1$." },
        { id: "s2", ex: "Suppose without loss of generality that $x \\geq y$." },
        { id: "s3", ex: "Then the shorter side of a rectangle containing both squares without overlap must be at least $x$, and the longer side must be at least $x+y$." },
        { id: "s4", ex: "Hence the desired value of $A$ is the maximum of $x(x+y)$." },
        { id: "s5", ex: "To find this maximum, we let $x = \\cos \\theta, y = \\sin \\theta$ with $\\theta \\in [0, \\pi/4]$." },
        { id: "s6", ex: "with equality for $\\theta = \\pi/8$." },
      ],
      wrong: [
        { text: "Then the rectangle must have both sides at least $x+y$, so $A$ is the maximum of $(x+y)^2$.", why: "The smaller square fits beside the larger one: the short side only needs to be x." },
        { text: "Then the rectangle must have sides at least $x$ and $y$, so $A$ is the maximum of $xy$.", why: "Both squares must fit without overlap, so the long side has to hold both: x + y." },
      ],
    },
    {
      id: "1996-B2", crucial: "s1",
      statement: "Show that for every positive integer $n$, $\\left( \\frac{2n-1}{e} \\right)^{\\frac{2n-1}{2}} < 1 \\cdot 3 \\cdot 5 \\cdots (2n-1) < \\left( \\frac{2n+1}{e} \\right)^{\\frac{2n+1}{2}}$.",
      steps: [
        { id: "s1", ex: "By estimating the area under the graph of $\\ln x$ using upper and lower rectangles of width 2, we get" },
        { id: "s2", ex: "\\begin{align*} \\int_1^{2n-1} \\ln x\\,dx &\\leq 2(\\ln(3) + \\cdots + \\ln(2n-1)) \\\\ &\\leq \\int_3^{2n+1} \\ln x\\,dx. \\end{align*}" },
        { id: "s3", ex: "Since $\\int \\ln x\\,dx = x \\ln x - x + C$, we have, upon exponentiating and taking square roots," },
        { id: "s4", ex: "using the fact that $1 < e < 3$." },
      ],
      wrong: [
        { text: "By Stirling's formula $n! \\sim \\sqrt{2\\pi n}\\,(n/e)^n$, we get", why: "Stirling is asymptotic: it can't give an inequality for every n." },
        { text: "By the AM–GM inequality applied to $1, 3, \\ldots, 2n-1$, we get", why: "AM–GM bounds the product above by nⁿ only; it can't produce the two-sided e-bounds." },
      ],
    },
    {
      id: "1997-A4", crucial: "s2",
      statement: "Let $G$ be a group with identity $e$ and $\\phi: G \\to G$ a function such that $\\phi(g_1)\\phi(g_2)\\phi(g_3) = \\phi(h_1)\\phi(h_2)\\phi(h_3)$ whenever $g_1g_2g_3 = e = h_1h_2h_3$. Prove there is $a \\in G$ such that $\\psi(x) = a\\phi(x)$ is a homomorphism.",
      steps: [
        { id: "s1", ex: "and so we take $a = \\phi(e)^{-1}$.", after: [] },
        { id: "s2", ex: "\\[ \\phi(g) \\phi(e) \\phi(g^{-1}) = \\phi(e) \\phi(g) \\phi(g^{-1}) \\] and so $\\phi(g)$ commutes with $\\phi(e)$ for all $g$.", after: [] },
        { id: "s3", ex: "\\[ \\phi(x) \\phi(y) \\phi(y^{-1}x^{-1}) = \\phi(e) \\phi(xy) \\phi(y^{-1}x^{-1}) \\]", after: [] },
        { id: "s4", ex: "and using the commutativity of $\\phi(e)$, we deduce \\[ \\phi(e)^{-1} \\phi(x) \\phi(e)^{-1} \\phi(y) = \\phi(e)^{-1} \\phi(xy) \\]", after: ["s2", "s3"] },
        { id: "s5", ex: "or $\\psi(xy) = \\psi(x) \\psi(y)$, as desired.", after: ["s1", "s4"] },
      ],
      wrong: [
        { text: "Since $G$ is abelian, $\\phi(g)$ commutes with $\\phi(e)$ for all $g$.", why: "G needn't be abelian. The commuting comes from the hypothesis, since g·e·g⁻¹ = e = e·g·g⁻¹." },
        { text: "Taking $g_1 = g_2 = g_3 = e$ shows $\\phi(e) = e$.", why: "The hypothesis only compares triple products of φ-values; it never pins φ(e) to e, which is why a = φ(e)⁻¹ is needed." },
      ],
    },
    {
      id: "1998-B3", crucial: "s2",
      statement: "Let $H$ be the unit hemisphere $\\{x^2+y^2+z^2=1, z \\ge 0\\}$ and $P$ the regular pentagon inscribed in the unit circle in the plane $z = 0$. Find the area of the part of $H$ lying over the region inside $P$.",
      steps: [
        { id: "s1", ex: "We use the well-known result that the surface area of the ``sphere cap'' $\\{(x,y,z)\\,|\\,x^2+y^2+z^2=1,\\,z\\geq z_0\\}$ is simply $2\\pi(1-z_0)$.", after: [] },
        { id: "s2", ex: "Now the desired surface area is just $2\\pi$ minus the surface areas of five identical halves of sphere caps;", after: [] },
        { id: "s3", ex: "these caps, up to isometry, correspond to $z_0$ being the distance from the center of the pentagon to any of its sides, i.e., $z_0 = \\cos \\frac{\\pi}{5}$.", after: ["s2"] },
        { id: "s4", ex: "Thus the desired area is $2\\pi - \\frac{5}{2} \\left(2\\pi (1-\\cos\\frac{\\pi}{5})\\right) = 5\\pi\\cos\\frac{\\pi}{5} - 3\\pi$", after: ["s1", "s3"] },
      ],
      wrong: [
        { text: "Now the desired surface area is just $2\\pi$ minus the surface areas of five identical sphere caps;", why: "Only the half of each cap with z ≥ 0 lies on the hemisphere." },
        { text: "Now the desired surface area equals the area of the pentagon itself, since projecting down to the plane preserves area.", why: "Vertical projection shrinks area on a sphere; subtract the caps instead." },
      ],
    },
    {
      id: "1999-A1", crucial: "s1",
      statement: "Find polynomials $f, g, h$, if they exist, such that $|f(x)| - |g(x)| + h(x)$ equals $-1$ for $x < -1$, $3x + 2$ for $-1 \\le x \\le 0$, and $-2x + 2$ for $x > 0$.",
      steps: [
        { id: "s1", ex: "Note that if $r(x)$ and $s(x)$ are any two functions, then \\[ \\max(r,s) = (r+s + |r-s|)/2.\\]" },
        { id: "s2", ex: "Therefore, if $F(x)$ is the given function, we have" },
        { id: "s3", ex: "so we may set $f(x)=(3x+3)/2$, $g(x) = 5x/2$, and $h(x)=-x+\\frac{1}{2}$." },
      ],
      wrong: [
        { text: "Note that if $r(x)$ and $s(x)$ are any two functions, then \\[ \\max(r,s) = (r+s - |r-s|)/2.\\]", why: "That is min(r, s): subtracting |r − s| lands on the smaller one." },
        { text: "Note that $|r + s| = |r| + |s|$ for any two functions $r, s$.", why: "Only when r and s have the same sign; the kinks come from where they don't." },
      ],
    },
    {
      id: "2001-A4", crucial: "s5",
      statement: "Triangle $ABC$ has area 1. Points $E, F, G$ lie on $BC, CA, AB$ such that $AE$ bisects $BF$ at $R$, $BF$ bisects $CG$ at $S$, and $CG$ bisects $AE$ at $T$. Find the area of triangle $RST$.",
      steps: [
        { id: "s1", ex: "Choose $r,s,t$ so that $EC = rBC, FA = sCA, GB = tCB$, and let $[XYZ]$ denote the area of triangle $XYZ$." },
        { id: "s2", ex: "Then $[ABE] = [AFE]$ since the triangles have the same altitude and base." },
        { id: "s3", ex: "or $r(1+s) = 1$. Similarly $s(1+t) = t(1+r) = 1$." },
        { id: "s4", ex: "Let $f: [0, \\infty) \\to [0, \\infty)$ be the function given by $f(x) = 1/(1+x)$; then $f(f(f(r))) = r$." },
        { id: "s5", ex: "However, $f(x)$ is strictly decreasing in $x$, so $f(f(x))$ is increasing and $f(f(f(x)))$ is decreasing." },
        { id: "s6", ex: "in fact, since the equation $f(z) = z$ has a positive root $z = (-1 + \\sqrt{5})/2$, we must have $r=s=t=z$." },
      ],
      wrong: [
        { text: "However, $f(x)$ is strictly decreasing in $x$, so $f(f(f(x)))$ is increasing.", why: "Composing three decreasing functions gives a decreasing function." },
        { text: "Since $f$ is continuous, $f(f(f(x))) = x$ has exactly one solution.", why: "Continuity allows many fixed points; being decreasing is what forces there to be only one." },
      ],
    },
    {
      id: "2001-B2", crucial: "s2",
      statement: "Find all pairs of real numbers $(x, y)$ with $\\frac{1}{x} + \\frac{1}{2y} = (x^2+3y^2)(3x^2+y^2)$ and $\\frac{1}{x} - \\frac{1}{2y} = 2(y^4 - x^4)$.",
      steps: [
        { id: "s1", ex: "By adding and subtracting the two given equations, we obtain the equivalent pair of equations" },
        { id: "s2", ex: "Multiplying the former by $x$ and the latter by $y$, then adding and subtracting the two resulting equations, we obtain another pair of equations equivalent to the given ones, \\[ 3 = (x+y)^5, \\qquad 1 = (x-y)^5. \\]" },
        { id: "s3", ex: "It follows that $x = (3^{1/5}+1)/2$ and $y = (3^{1/5}-1)/2$ is the unique solution satisfying the given equations." },
      ],
      wrong: [
        { text: "Multiplying the former by $x$ and the latter by $y$, then adding the two resulting equations, we obtain \\[ 3 = (x+y)^4. \\]", why: "The coefficients 1, 5, 10, 10, 5, 1 are a fifth power: (x ± y)⁵." },
        { text: "Dividing the first equation by the second gives $y = 2x$.", why: "The right-hand sides aren't proportional, so dividing loses the structure rather than revealing it." },
      ],
    },
    {
      id: "2002-A5", crucial: "s4",
      statement: "Define $a_0 = 1$, $a_{2n+1} = a_n$ and $a_{2n+2} = a_n + a_{n+1}$ for $n \\ge 0$. Prove that every positive rational number appears among the fractions $a_{n-1}/a_n$, $n \\ge 1$.",
      steps: [
        { id: "s1", ex: "It suffices to prove that for any relatively prime positive integers $r,s$, there exists an integer $n$ with $a_n = r$ and $a_{n+1} = s$." },
        { id: "s2", ex: "We prove this by induction on $r+s$, the case $r+s=2$ following from the fact that $a_0=a_1 = 1$." },
        { id: "s3", ex: "Given $r$ and $s$ not both 1 with $\\gcd(r,s) = 1$, we must have $r \\neq s$." },
        { id: "s4", ex: "If $r>s$, then by the induction hypothesis we have $a_n = r-s$ and $a_{n+1} = s$ for some $n$; then $a_{2n+2} = r$ and $a_{2n+3} = s$.", after: ["s3"] },
        { id: "s5", ex: "If $r< s$, then we have $a_n = r$ and $a_{n+1} = s-r$ for some $n$; then $a_{2n+1} = r$ and $a_{2n+2} = s$.", after: ["s3"] },
      ],
      wrong: [
        { text: "If $r>s$, then by the induction hypothesis we have $a_n = r$ and $a_{n+1} = s$ for some $n$.", why: "That assumes the pair (r, s) itself. Induction may only use a smaller r + s, such as (r − s, s)." },
        { text: "If $r>s$, then $a_{2r} = r$ and $a_{2r+1} = s$ directly from the definition.", why: "The index isn't determined by r; it comes from the smaller pair, via the induction hypothesis." },
      ],
    },
    {
      id: "2002-B1", crucial: "s1",
      statement: "A player hits the first free throw and misses the second; after that, the probability of hitting the next shot equals the proportion of shots hit so far. What is the probability of hitting exactly 50 of the first 100 shots?",
      steps: [
        { id: "s1", ex: "In fact, we show by induction on $n$ that after $n$ shots, the probability of having made any number of shots from $1$ to $n-1$ is equal to $1/(n-1)$." },
        { id: "s2", ex: "This is evident for $n=2$." },
        { id: "s3", ex: "Given the result for $n$, we see that the probability of making $i$ shots after $n+1$ attempts is", after: ["s1"] },
      ],
      wrong: [
        { text: "In fact, the number of hits after $n$ shots is binomial with success probability $1/2$.", why: "Each shot's probability depends on the past, so the shots aren't independent." },
        { text: "In fact, the probability of hitting exactly half of $n$ shots is $1/2$ for every even $n$.", why: "The count is uniform on 1, …, n − 1, so any single value has probability 1/(n − 1)." },
      ],
    },
    {
      id: "2003-B2", crucial: "s2",
      statement: "Starting from $1, \\frac12, \\frac13, \\ldots, \\frac1n$, repeatedly replace the sequence by the averages of neighbouring entries until one number $x_n$ remains. Show that $x_n < 2/n$.",
      steps: [
        { id: "s1", ex: "It is easy to see by induction that the $j$-th entry of the $k$-th sequence (where the original sequence is $k=1$) is $\\sum_{i=1}^k \\binom{k-1}{i-1}/(2^{k-1} (i+j-1))$, and so $x_n = \\frac{1}{2^{n-1}} \\sum_{i=1}^n \\binom{n-1}{i-1}/i$." },
        { id: "s2", ex: "Now $\\binom{n-1}{i-1}/i = \\binom{n}{i}/n$; hence" },
        { id: "s3", ex: "\\[ x_n = \\frac{1}{n2^{n-1}} \\sum_{i=1}^n \\binom{n}{i} = \\frac{2^n-1}{n 2^{n-1}} < 2/n, \\] as desired." },
      ],
      wrong: [
        { text: "Now $\\binom{n-1}{i-1}/i = \\binom{n}{i}$; hence", why: "The 1/n is missing: i·C(n, i) = n·C(n − 1, i − 1)." },
        { text: "Now $\\sum_{i=1}^n \\binom{n-1}{i-1}/i \\leq \\sum_{i=1}^n \\binom{n-1}{i-1} = 2^{n-1}$; hence", why: "That bound only gives xₙ ≤ 1, far weaker than 2/n." },
      ],
    },
    {
      id: "2007-B1", crucial: "s2",
      statement: "Let $f$ be a nonconstant polynomial with positive integer coefficients. Prove that for a positive integer $n$, $f(n)$ divides $f(f(n)+1)$ if and only if $n = 1$.",
      steps: [
        { id: "s1", ex: "Write $f(n) = \\sum_{i=0}^d a_i n^i$ with $a_i > 0$." },
        { id: "s2", ex: "Then \\begin{align*} f(f(n)+1) &= \\sum_{i=0}^d a_i (f(n) + 1)^i \\\\ &\\equiv f(1) \\pmod{f(n)}. \\end{align*}" },
        { id: "s3", ex: "If $n = 1$, then this implies that $f(f(n)+1)$ is divisible by $f(n)$.", after: ["s2"] },
        { id: "s4", ex: "Otherwise, $0 < f(1) < f(n)$ since $f$ is nonconstant and has positive coefficients, so $f(f(n)+1)$ cannot be divisible by $f(n)$.", after: ["s2"] },
      ],
      wrong: [
        { text: "Then $f(f(n)+1) \\equiv f(n) + 1 \\pmod{f(n)}$.", why: "Reduce inside f: (f(n) + 1)ⁱ ≡ 1, so the sum is Σ aᵢ = f(1)." },
        { text: "Then $f(f(n)+1) \\equiv 0 \\pmod{f(n)}$ for every $n$.", why: "Each (f(n) + 1)ⁱ is ≡ 1, not 0, mod f(n)." },
      ],
    },
    {
      id: "2010-A1", crucial: "s4",
      statement: "Given a positive integer $n$, what is the largest $k$ such that $1, 2, \\ldots, n$ can be put into $k$ boxes with the same sum in each box?",
      steps: [
        { id: "s1", ex: "The largest such $k$ is $\\lfloor \\frac{n+1}{2} \\rfloor = \\lceil \\frac{n}{2} \\rceil$." },
        { id: "s2", ex: "For $n$ even, this value is achieved by the partition \\[ \\{1, n\\}, \\{2, n-1\\}, \\dots; \\]", after: ["s1"] },
        { id: "s3", ex: "for $n$ odd, it is achieved by the partition \\[ \\{n\\}, \\{1, n-1\\}, \\{2, n-2\\}, \\dots. \\]", after: ["s1"] },
        { id: "s4", ex: "One way to see that this is optimal is to note that the common sum can never be less than $n$, since $n$ itself belongs to one of the boxes.", after: ["s1"] },
        { id: "s5", ex: "This implies that $k \\leq (1 + \\cdots + n)/n = (n+1)/2$.", after: ["s4"] },
      ],
      wrong: [
        { text: "One way to see that this is optimal is to note that each box must contain at least two numbers.", why: "For odd n the box {n} stands alone: boxes can be singletons." },
        { text: "One way to see that this is optimal is to note that the common sum can never be less than $n+1$, since $1$ and $n$ are in the same box.", why: "Nothing forces 1 and n together; the bound comes from n alone." },
      ],
    },
    {
      id: "2011-A4", crucial: "s4",
      statement: "For which positive integers $n$ is there an $n \\times n$ integer matrix in which every row has an even dot product with itself, while any two different rows have an odd dot product?",
      steps: [
        { id: "s1", ex: "The answer is $n$ odd." },
        { id: "s2", ex: "If $n$ is odd, then the matrix $A-I$ satisfies the conditions of the problem: the dot product of any row with itself is $n-1$, and the dot product of any two distinct rows is $n-2$.", after: ["s1"] },
        { id: "s3", ex: "Conversely, suppose $n$ is even, and suppose that the matrix $M$ satisfied the conditions of the problem.", after: ["s1"] },
        { id: "s4", ex: "Since the dot product of a row with itself is equal mod $2$ to the sum of the entries of the row, we have $M v = 0$ where $v$ is the vector $(1,1,\\ldots,1)$, and so $M$ is singular.", after: ["s3"] },
        { id: "s5", ex: "On the other hand, $M M^T = A-I$; since \\[ (A-I)^2 = A^2-2A+I = (n-2)A+I = I, \\]", after: ["s3"] },
        { id: "s6", ex: "we have $(\\det M)^2 = \\det(A-I) = 1$ and $\\det M = 1$, contradicting the fact that $M$ is singular.", after: ["s4", "s5"] },
      ],
      wrong: [
        { text: "Since each row has an even dot product with itself, every entry of $M$ is even, so $M$ is singular mod $2$.", why: "A row's dot product with itself is, mod 2, the sum of its entries, which can be even when the entries are odd." },
        { text: "Since distinct rows have odd dot products, the rows are linearly independent mod $2$, so $M$ is singular.", why: "Independence would make M invertible, not singular; the singularity comes from Mv = 0." },
      ],
    },
    {
      id: "2016-A3", crucial: "s3",
      statement: "Suppose $f: \\mathbb{R} \\to \\mathbb{R}$ satisfies $f(x) + f\\left(1 - \\frac1x\\right) = \\arctan x$ for all $x \\ne 0$. Find $\\int_0^1 f(x)\\,dx$.",
      steps: [
        { id: "s1", ex: "The given functional equation, along with the same equation but with $x$ replaced by $\\frac{x-1}{x}$ and $\\frac{1}{1-x}$ respectively, yields:" },
        { id: "s2", ex: "Adding the first and third equations and subtracting the second gives: \\[ 2f(x) = \\tan^{-1}(x) + \\tan^{-1}\\left(\\frac{1}{1-x}\\right) - \\tan^{-1}\\left(\\frac{x-1}{x}\\right). \\]" },
        { id: "s3", ex: "Now $\\tan^{-1}(t) + \\tan^{-1}(1/t)$ is equal to $\\pi/2$ if $t>0$ and $-\\pi/2$ if $t<0$;", after: [] },
        { id: "s4", ex: "Thus \\[ 4\\int_0^1 f(x)\\,dx = 2\\int_0^1 (f(x)+f(1-x))dx = \\frac{3\\pi}{2} \\]", after: ["s2", "s3"] },
        { id: "s5", ex: "and finally $\\int_0^1 f(x)\\,dx = \\frac{3\\pi}{8}$.", after: ["s4"] },
      ],
      wrong: [
        { text: "Now $\\tan^{-1}(t) + \\tan^{-1}(1/t) = \\pi/2$ for every $t \\neq 0$;", why: "For t < 0 the sum is −π/2, and the third pair has a negative argument." },
        { text: "Now $\\tan^{-1}(t) + \\tan^{-1}(1-t) = \\pi/2$ for every $t$;", why: "The identity pairs t with 1/t, not with 1 − t." },
      ],
    },
    {
      id: "2022-B3", crucial: "s2",
      statement: "Color each positive real red or blue. Let $D$ be the set of distances $d > 0$ between two points of the same color; recolor so that $D$ is red and the rest blue. Iterating, do we always reach all red after finitely many steps?",
      steps: [
        { id: "s1", ex: "Let $R_0,B_0 \\subset \\mathbb{R}^+$ be the set of red and blue numbers at the start of the process, and let $R_n,B_n$ be the set of red and blue numbers after $n$ steps. We claim that $R_2 = \\mathbb{R}^+$." },
        { id: "s2", ex: "We first note that if $y \\in B_1$, then $y/2 \\in R_1$. Namely, the numbers $y$ and $2y$ must be of opposite colors in the original coloring, and then $3y/2$ must be of the same color as one of $y$ or $2y$.", after: ["s1"] },
        { id: "s3", ex: "Now suppose by way of contradiction that $x \\in B_2$. Then of the four numbers $x,2x,3x,4x$, every other number must be in $R_1$ and the other two must be in $B_1$.", after: ["s1"] },
        { id: "s4", ex: "By the previous observation, $2x$ and $4x$ cannot both be in $B_1$; it follows that $2x,4x \\in R_1$ and $x,3x \\in B_1$.", after: ["s2", "s3"] },
        { id: "s5", ex: "By the previous observation again, $x/2$ and $3x/2$ must both be in $R_1$, but then $x = 3x/2-x/2$ is in $R_2$, contradiction.", after: ["s4"] },
      ],
      wrong: [
        { text: "We first note that if $y \\in B_1$, then $2y \\in R_1$.", why: "The argument gives y/2, the distance from 3y/2 to y or to 2y, not 2y." },
        { text: "We first note that $B_1$ is empty, since two points at any distance $d$ share a color.", why: "Nothing forces two points at distance d to share a color, which is why B₁ can be nonempty." },
      ],
    },
    {
      id: "2024-A1", crucial: "s3",
      statement: "Prove that $2a^2 + 3b^2 = 4c^2$ has no solution in positive integers.",
      steps: [
        { id: "s1", ex: "For $n = 2$, suppose that we have a solution to $2a^2+3b^2=4c^2$ with $a,b,c\\in\\mathbb{N}$." },
        { id: "s2", ex: "By dividing each of $a,b,c$ by $\\gcd(a,b,c)$, we obtain another solution; thus we can assume that $\\gcd(a,b,c) = 1$." },
        { id: "s3", ex: "Note that we have $a^2+c^2 \\equiv 0 \\pmod{3}$, and that only $0$ and $1$ are perfect squares mod $3$; thus we must have $a^2 \\equiv c^2 \\equiv 0 \\pmod{3}$." },
        { id: "s4", ex: "But then $a,c$ are both multiples of $3$; it follows from $b^2 = 12(c/3)^2-6(a/3)^2$ that $b$ is a multiple of $3$ as well, contradicting our assumption that $\\gcd(a,b,c)=1$." },
      ],
      wrong: [
        { text: "Note that $2a^2 + 3b^2 \\equiv 0 \\pmod{4}$ forces $a$ and $b$ to both be even.", why: "Mod 4 doesn't force that; the argument works mod 3, where the squares are only 0 and 1." },
        { text: "Note that $a^2 + c^2 \\equiv 0 \\pmod{3}$ forces $a \\equiv -c \\pmod{3}$, which is all we need.", why: "Squares mod 3 are only 0 or 1, so a² + c² ≡ 0 forces both squares to be 0: a and c divisible by 3." },
      ],
    },
  ];

  // The full bank is site/putnam-steps.json (built by scripts/build_putnam_steps.mjs):
  // too big to ship with every page, so it loads on demand and the pilot above
  // serves until it arrives. Node tools pass it in as PUTNAM_STEPS.
  const root = typeof self !== "undefined" ? self : this;
  let BANK = PROBLEMS;
  if (Array.isArray(root.PUTNAM_STEPS)) BANK = root.PUTNAM_STEPS;
  else if (typeof fetch === "function") {
    fetch("putnam-steps.json").then((r) => (r.ok ? r.json() : null))
      .then((bank) => { if (Array.isArray(bank) && bank.length) BANK = bank; }).catch(() => {});
  }
  const shown = (st) => st.show ?? st.ex;

  // Word flips that turn a true step false. Checked per problem by the
  // verifier, and listed for review: a flip can occasionally leave a step true.
  const FLIPS = [
    [/\\leq/g, "\\geq", "The inequality points the other way."],
    [/strictly decreasing/g, "strictly increasing", "The monotonicity is reversed."],
    [/\bsingular\b/g, "invertible", "It's the other way round: Mv = 0 makes M singular."],
    [/\beven\b/g, "odd", "The parity is flipped."],
    [/at most/g, "at least", "The bound points the other way."],
    [/\$t>0\$ and \$-\\pi\/2\$ if \$t<0\$/g, "$t<0$ and $-\\pi/2$ if $t>0$", "The signs are swapped: the sum is +π/2 for positive t."],
  ];

  function mutate(text) {
    for (const [re, to, why] of FLIPS) {
      if (re.test(text)) { re.lastIndex = 0; return { text: text.replace(re, to), why }; }
    }
    return null;
  }

  /** Steps that (transitively) need `id`: out of place wherever `id` goes. */
  function dependents(p, id) {
    const deps = (st, i) => st.after ?? (i ? [p.steps[i - 1].id] : []);
    const out = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      p.steps.forEach((st, i) => {
        if (!out.has(st.id) && deps(st, i).some((d) => out.has(d))) { out.add(st.id); grew = true; }
      });
    }
    out.delete(id);
    return p.steps.filter((st) => out.has(st.id));
  }

  const shuffle = (xs, r) => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };

  M.define({
    id: "pt-steps", name: "Putnam proofs, step by step",
    domain: "competition math", prose: true, source: SOURCE, concepts: [],
    blurb: "Real Putnam solutions: fill in the key step, or put the steps in order.",
    gen(level, r) {
      const p = r.pick(BANK);
      const crucial = p.steps.find((st) => st.id === p.crucial);
      const written = shuffle(p.wrong, r).map((w) => ({ answer: w.text, why: w.why, kind: "written" }));
      const later = dependents(p, crucial.id).map((st) => ({
        answer: shown(st), kind: "misplaced",
        why: "That step comes later: it relies on the step that's missing here.",
      }));
      const flip = mutate(shown(crucial));
      const mutated = flip && flip.text !== shown(crucial) ? [{ answer: flip.text, why: flip.why, kind: "mutated" }] : [];
      const others = BANK.filter((q) => q !== p);
      const other = others[Math.floor(r() * others.length)];
      const foreignStep = other.steps[Math.floor(r() * other.steps.length)];
      const foreign = [{ answer: shown(foreignStep), kind: "foreign", why: `That step is from a different problem (Putnam ${other.id}).` }];

      if (level <= 2) {
        const pool = level === 1
          ? [written[0], ...shuffle([...later, ...foreign], r)]
          : [written[0], ...mutated, ...shuffle(later, r), written[1]];
        const lines = p.steps.map((st, i) => `${i + 1}. ${st.id === crucial.id ? "[ ? ]" : shown(st)}`);
        return {
          prompt: `Putnam ${p.id}. ${p.statement}\n\nWhich line completes this solution?\n\n${lines.join("\n\n")}`,
          answer: shown(crucial), format: "choice",
          mistakes: pool.filter(Boolean).slice(0, 3).map(({ answer, why }) => ({ answer, why })),
          steps: p.steps.map(shown), trick: "Each line must follow from the ones above it.",
          params: { problem: p.id },
        };
      }
      // Build the whole solution: the steps plus planted lines (one written
      // misconception, and a mutation where one exists).
      const planted = [written[0], ...(level >= 4 ? mutated : [])].filter(Boolean)
        .map((w, i) => ({ id: `x${i + 1}`, text: w.answer, why: w.why }));
      const steps = p.steps.map((st) => ({ id: st.id, text: shown(st), after: st.after }));
      return {
        prompt: `Putnam ${p.id}. ${p.statement}\n\nBuild the solution: put the lines in order, and leave out any that don't belong.`,
        answer: steps.map((st) => st.id).join(","), kind: "order", typed: true,
        steps, extras: planted,
        lines: shuffle([...steps, ...planted].map(({ id, text }) => ({ id, text })), r),
        trick: "Each line must follow from the ones above it.",
        params: { problem: p.id },
      };
    },
  });

  // For the verifier: the raw data, so every excerpt can be checked against
  // the published solution.
  Object.defineProperty(M, "putnamSteps", { get: () => BANK });
  M.putnamMutate = mutate;
})();
