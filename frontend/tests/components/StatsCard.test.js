import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import StatsCard from "../../src/components/StatsCard.vue";

const mountCard = (props) => mount(StatsCard, { props });

describe("StatsCard", () => {
  it("renders label and value", () => {
    const wrapper = mountCard({ label: "文章数", value: 42 });
    expect(wrapper.text()).toContain("文章数");
    expect(wrapper.text()).toContain("42");
  });

  it("renders sub text when provided", () => {
    const wrapper = mountCard({ label: "x", value: 0, sub: "较上月+10%" });
    expect(wrapper.text()).toContain("较上月+10%");
  });

  it("does not render sub paragraph when sub is empty", () => {
    const wrapper = mountCard({ label: "x", value: 0 });
    const paras = wrapper.findAll("p");
    const texts = paras.map((p) => p.text());
    expect(texts.every((t) => t !== "较上月+10%")).toBe(true);
    expect(paras.length).toBe(2);
  });

  it('displays "1.0w" for value 10000', () => {
    const wrapper = mountCard({ label: "x", value: 10000 });
    expect(wrapper.text()).toContain("1.0w");
  });

  it('displays "2.5w" for value 25000', () => {
    const wrapper = mountCard({ label: "x", value: 25000 });
    expect(wrapper.text()).toContain("2.5w");
  });

  it("displays comma-formatted number for 9999", () => {
    const wrapper = mountCard({ label: "x", value: 9999 });
    expect(wrapper.text()).toContain("9,999");
  });
});
