import { HomeLayout } from "fumadocs-ui/layouts/home";
import Image from "next/image";
import type { Metadata } from "next";
import { Hero } from "@/components/landing/hero";
import { Features } from "@/components/landing/features";
import { Footer } from "@/components/landing/footer";

export const metadata: Metadata = {
  alternates: {
    canonical: "https://noddde.dev",
  },
};

export default function HomePage() {
  return (
    <HomeLayout
      nav={{
        title: (
          <div className="flex items-center gap-2">
            <Image
              src="/icon-light.png"
              alt=""
              width={20}
              height={14}
              className="logo-light"
            />
            <Image
              src="/icon-dark.png"
              alt=""
              width={20}
              height={14}
              className="logo-dark"
            />
            <span className="font-semibold">noddde</span>
          </div>
        ),
        transparentMode: "top",
      }}
      links={[
        {
          type: "main",
          text: "Documentation",
          url: "/docs",
          active: "none",
        },
      ]}
      githubUrl="https://github.com/dogganidhal/noddde"
    >
      <Hero />
      <Features />
      <Footer />
    </HomeLayout>
  );
}
