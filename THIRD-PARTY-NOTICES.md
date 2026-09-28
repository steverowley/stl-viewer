# Third-Party Notices

STL Viewer incorporates the third-party components listed below. Each remains
governed by its own licence, reproduced here as those licences require.

These notices apply only to the third-party components. All original STL Viewer
code is proprietary — see [LICENSE](LICENSE).

---

## three.js

- **Version:** r149
- **Location in this repository:** `vendor/three.min.js`, `app/src/wwwroot/vendor/three.min.js`
- **Homepage:** https://threejs.org
- **Licence:** MIT

The MIT licence permits commercial use and redistribution provided the copyright
notice and permission notice are retained. The notice is preserved in the header
of the distributed file and reproduced below.

```
The MIT License

Copyright © 2010-2023 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

---

## Microsoft.Web.WebView2

- **Version:** 1.0.2903.40
- **Usage:** NuGet package reference; not redistributed in source form
- **Licence:** Microsoft Software Licence Terms for WebView2 SDK
- **Terms:** https://aka.ms/WebView2LicenseTerms

The WebView2 SDK licence permits distribution as part of an application. The
WebView2 **runtime** is a Windows component installed on the end user's machine
and is not redistributed by this project.

---

## .NET Runtime

- **Version:** .NET 9
- **Usage:** Bundled into the published executable via self-contained deployment
- **Licence:** MIT
- **Terms:** https://github.com/dotnet/runtime/blob/main/LICENSE.TXT

The MIT licence permits redistribution of the runtime as part of a
self-contained application.

---

## Commercial distribution note

All three components above permit commercial redistribution. three.js and the
.NET runtime require their copyright notices to be preserved — this file, shipped
alongside the application, satisfies that requirement. If you distribute the
compiled application, include this file with it.
