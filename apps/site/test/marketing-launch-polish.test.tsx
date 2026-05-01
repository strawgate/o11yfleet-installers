import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import MarketingLayout from "../src/layouts/MarketingLayout";
import MarketingNotFoundPage from "../src/pages/marketing/NotFoundPage";
import ProductConfigPage from "../src/pages/marketing/ProductConfigPage";
import GitOpsPage from "../src/pages/marketing/GitOpsPage";

void React;

function renderMarketingAt(path: string) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<MarketingLayout />}>
          <Route path="/" element={<div>home</div>} />
          <Route path="/product/configuration-management" element={<div>product</div>} />
          <Route path="/product/configuration-management/*" element={<div>product nested</div>} />
          <Route path="/enterprise" element={<div>enterprise</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function hasActiveProductLink(html: string) {
  const productLink =
    /<a[^>]*href="\/product\/configuration-management"[^>]*>|<a[^>]*aria-current="page"[^>]*href="\/product\/configuration-management"[^>]*>/;
  if (!productLink.test(html)) return false;
  return /aria-current="page"[^>]*href="\/product\/configuration-management"|href="\/product\/configuration-management"[^>]*aria-current="page"/.test(
    html,
  );
}

test("marketing pages do not include literal illustration placeholders", () => {
  const productHtml = renderToStaticMarkup(
    <MemoryRouter>
      <ProductConfigPage />
    </MemoryRouter>,
  );
  const gitOpsHtml = renderToStaticMarkup(
    <MemoryRouter>
      <GitOpsPage />
    </MemoryRouter>,
  );

  assert.doesNotMatch(productHtml, /\[illustration\]/);
  assert.doesNotMatch(gitOpsHtml, /\[illustration\]/);
});

test("marketing 404 routes anonymous users to home instead of portal", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <MarketingNotFoundPage />
    </MemoryRouter>,
  );

  assert.match(html, /href="\/"/);
  assert.doesNotMatch(html, /\/portal\/overview/);
});

test("marketing nav keeps aria-current for active internal section links", () => {
  const productHtml = renderMarketingAt("/product/configuration-management");
  assert.ok(
    hasActiveProductLink(productHtml),
    "expected product nav link to have aria-current=page on exact path",
  );

  const enterpriseHtml = renderMarketingAt("/enterprise");
  assert.match(
    enterpriseHtml,
    /aria-current="page"[^>]*href="\/enterprise"|href="\/enterprise"[^>]*aria-current="page"/,
  );
});

test("marketing nav keeps aria-current on nested product routes", () => {
  const nestedHtml = renderMarketingAt("/product/configuration-management/history");
  assert.ok(
    hasActiveProductLink(nestedHtml),
    "expected product nav link to remain active on nested /product/configuration-management/* paths",
  );
});
