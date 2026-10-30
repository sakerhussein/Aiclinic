/* Limitsiz Clinic: English / Arabic text and language switching */
(function () {
  "use strict";

  var EN = {
    skip: "Skip to content",
    nav_solutions: "Solutions", nav_how: "How It Works", nav_security: "Security",
    nav_pricing: "Pricing", nav_faq: "FAQ", nav_demo: "Book a Demo",

    hero_eyebrow: "AI agents for healthcare",
    hero_title: "Orchestrated AI Agents for Private Clinics",
    hero_sub: "Limitsiz Clinic connects booking, reception, documentation and finance into one coordinated system. Your team spends less time on admin and more time with patients.",
    hero_btn1: "Book a Free Demo", hero_btn2: "See How It Works",
    hero_trust: "Your patient data stays in your own database.",

    problem_title: "Admin work is costing your clinic patients and time.",
    problem_1: "Missed calls and WhatsApp messages leave patients waiting for a reply, and some book elsewhere.",
    problem_2: "Manual scheduling, reminders, and follow-ups eat up your front desk's day.",
    problem_3: "Doctors spend evenings writing notes and reports instead of resting.",
    problem_4: "Revenue and unpaid invoices are tracked in spreadsheets, if at all.",

    solution_title: "One team of AI agents, working together.",
    solution_text: "Most clinic software does one job. Limitsiz Clinic runs a set of specialized AI agents that share information and hand tasks to each other. A booking becomes a reminder, a visit becomes a clinical note, and a payment becomes a financial record, without anyone re-typing the data.",

    agents_title: "Our Agents",
    agent_booking_title: "Booking Agent (WhatsApp)",
    agent_booking_text: "Patients book, reschedule, and cancel appointments by WhatsApp, any time of day. The agent checks your real availability and sends automatic reminders.",
    agent_recep_title: "AI Receptionist",
    agent_recep_text: "Answers common questions about services, prices, hours, and location. Routes urgent or complex calls to your staff with the context already summarized.",
    agent_scribe_title: "AI Scribe",
    agent_scribe_text: "Turns consultation notes into structured clinical documentation. The doctor reviews and approves every note before it is saved.",
    agent_reports_title: "Medical Reports",
    agent_reports_text: "Generates visit summaries and patient reports in seconds, ready for the doctor's review and signature.",
    agent_fin_title: "Clinic Financials",
    agent_fin_text: "Tracks daily revenue, payments, outstanding invoices, and service performance in one dashboard.",
    agent_assist_title: "Clinical Assistant",
    agent_assist_text: "Supports the doctor with reference information and checklists during care. The doctor always makes the final clinical decision.",

    how_title: "How It Works",
    step1_title: "1. Connect", step1_text: "Link your WhatsApp number, calendar, and existing systems. Setup is guided, and we handle the technical work.",
    step2_title: "2. Configure", step2_text: "Add your services, staff schedules, pricing, and clinic tone of voice. The agents learn your workflow, not a generic one.",
    step3_title: "3. Orchestrate", step3_text: "The agents work together around the clock. You see everything in one place and step in only where your judgment is needed.",

    day_title: "A Day in the Clinic",
    day_1: "<strong>8:12 AM.</strong> A patient messages on WhatsApp asking for a check-up. The Booking Agent offers three slots and confirms the one she chooses.",
    day_2: "<strong>11:40 AM.</strong> A caller asks about pricing. The Receptionist answers and passes the call to staff only when a person is needed.",
    day_3: "<strong>2:05 PM.</strong> The doctor finishes a consultation. The Scribe drafts the note, and the doctor approves it in one click.",
    day_4: "<strong>6:00 PM.</strong> The Financials agent updates the day's revenue and flags two unpaid invoices for follow-up.",
    day_outro: "Your team did the same work. The difference is that nothing fell through the cracks.",

    security_title: "Security and Privacy",
    security_headline: "Your patients' data belongs to your clinic.",
    sec_1_title: "Your database", sec_1_text: "Patient records are stored in your own local or cloud database, not in a third-party platform's storage.",
    sec_2_title: "Role-based access", sec_2_text: "Staff see only what their role requires.",
    sec_3_title: "Doctor in the loop", sec_3_text: "No clinical note or report is final until a licensed doctor approves it.",
    sec_4_title: "Encryption", sec_4_text: "Data is encrypted in transit and at rest.",
    sec_5_title: "Clear data handling", sec_5_text: "Patient data is not used to train AI models.",

    results_title: "Target Outcomes",
    results_label: "Targets, not guaranteed results. Figures will be updated with pilot data.",
    res_1_num: "50–70%", res_1_text: "fewer missed appointments with automatic reminders",
    res_2_num: "20 hours", res_2_text: "saved per week on front-desk admin",
    res_3_num: "5–10 min", res_3_text: "saved per consultation on documentation",
    res_4_text: "booking and patient replies, including outside working hours",

    pricing_title: "Simple plans that grow with your clinic.",
    pricing_note: "Prices in USD.",
    row_for: "Best for", row_agents: "Agents", row_support: "Support", row_price: "Price",
    plan_starter: "Starter", plan_pro: "Professional", plan_ent: "Enterprise",
    starter_for: "Single-doctor clinics", pro_for: "Multi-doctor clinics", ent_for: "Clinic groups",
    starter_agents: "Booking, Receptionist", pro_agents: "+ Scribe, Reports", ent_agents: "All agents, custom setup",
    starter_support: "Email", pro_support: "Priority", ent_support: "Dedicated manager",
    starter_price: "From $100/month", pro_price: "From $200/month", ent_price: "Contact us",
    pricing_btn: "Request a Trial",

    faq_title: "Frequently Asked Questions",
    faq_q1: "Do I need to change my current software?",
    faq_a1: "No. Limitsiz Clinic connects to the tools you already use. We start with what you have and move at your pace.",
    faq_q2: "Will patients know they are talking to AI?",
    faq_a2: "Yes. The Booking Agent and Receptionist identify themselves as your clinic's AI assistant, and urgent cases always go to your staff.",
    faq_q3: "Can my doctors override the AI?",
    faq_a3: "Always. Doctors review and approve every clinical output. The AI supports decisions. It does not make them.",
    faq_q4: "Where is my data stored?",
    faq_a4: "In your own database, either on your premises or in a cloud account you control.",
    faq_q5: "How long does setup take?",
    faq_a5: "Typically 1–2 days.",
    faq_q6: "Does it support Arabic?",
    faq_a6: "Yes. Patients can book and ask questions in Arabic and English.",

    contact_title: "Ready to run a smarter clinic?",
    contact_text: "Tell us about your clinic. We will show you exactly how the agents would work for your team.",
    form_name: "Full name", form_clinic: "Clinic name", form_email: "Email", form_phone: "Phone / WhatsApp",
    form_message: "Message (optional)",
    form_privacy: "By submitting, you agree to our <a href=\"privacy.html\">Privacy Policy</a>.",
    form_submit: "Request a Demo", form_sending: "Sending…",
    form_success: "Thank you! We received your request and will contact you shortly.",
    form_error: "We could not send your request. Please try again, or email us directly.",
    form_invalid: "Please enter your name and a valid email address.",
    form_spam: "Thank you! We received your request.",
    form_not_configured: "The form is not connected yet. Please email us directly.",
    contact_direct: "Or contact us directly:",

    footer_tagline: "Orchestrated AI Agents for Private Clinics",
    footer_address: "Amman, Jordan",
    footer_privacy: "Privacy Policy", footer_terms: "Terms",
    copyright: "© 2026 Limitsiz Clinic. All rights reserved.",

    draft_banner: "Draft for review. Pending legal review before publication.",
    priv_updated: "Last updated: October 2026",
    priv_title: "Privacy Policy",
    priv_h1: "1. Who we are",
    priv_p1: "Limitsiz Clinic is based in Amman, Jordan. You can contact us at management@limitsiz.si or on WhatsApp at 00962-795016514.",
    priv_h2: "2. Information we collect",
    priv_p2: "When you request a demo or contact us, we collect the details you submit: your name, clinic name, email address, phone number, and any message you write. We also collect basic technical information needed to keep the website working and secure.",
    priv_h3: "3. How we use it",
    priv_p3: "We use your information to respond to your request, arrange demonstrations, and tell you about our services. We do not sell your personal information.",
    priv_h4: "4. Where it is stored",
    priv_p4: "Contact and demo request details are stored in a secure database hosted on Supabase. Only authorized members of our team can access them.",
    priv_h5: "5. Patient data",
    priv_p5: "This website does not collect patient records. Clinics that use our product keep their patient data in their own database, and they control who can access it.",
    priv_h6: "6. How long we keep it",
    priv_p6: "We keep request details for as long as needed to respond to you and to maintain our business records. You can ask us to delete your details at any time.",
    priv_h7: "7. Your rights",
    priv_p7: "You may ask us to access, correct, or delete your personal information, or to stop contacting you. Email management@limitsiz.si and we will respond.",
    priv_h8: "8. Changes to this policy",
    priv_p8: "We may update this policy from time to time. The date at the top shows the latest version.",

    terms_title: "Terms of Use",
    terms_h1: "1. Using this website",
    terms_p1: "You may use this website for lawful purposes only. Do not attempt to disrupt, damage, or gain unauthorized access to the site or its systems.",
    terms_h2: "2. Information, not medical advice",
    terms_p2: "The content on this website describes our software and services. It is general information and is not medical advice. Clinical decisions remain the responsibility of licensed healthcare professionals.",
    terms_h3: "3. Services",
    terms_p3: "Our services are provided under a separate written agreement. Features, pricing, and targets shown on this website may change, and reported outcomes are targets, not guarantees.",
    terms_h4: "4. Intellectual property",
    terms_p4: "The content, design, and software on this website belong to Limitsiz Clinic or its licensors. You may not copy or reuse them without written permission.",
    terms_h5: "5. Limitation of liability",
    terms_p5: "To the extent permitted by law, the website is provided \"as is,\" and we are not liable for indirect or consequential losses arising from its use.",
    terms_h6: "6. Governing law",
    terms_p6: "These terms are governed by the laws of the Hashemite Kingdom of Jordan. [To be confirmed by counsel.]",
    terms_h7: "7. Contact",
    terms_p7: "Questions about these terms: management@limitsiz.si."
  };

  var AR = {
    skip: "تخطي إلى المحتوى",
    nav_solutions: "الحلول", nav_how: "كيف يعمل", nav_security: "الأمان",
    nav_pricing: "الأسعار", nav_faq: "الأسئلة الشائعة", nav_demo: "احجز عرضاً",

    hero_eyebrow: "وكلاء ذكاء اصطناعي للرعاية الصحية",
    hero_title: "وكلاء ذكاء اصطناعي منسّقون للعيادات الخاصة",
    hero_sub: "تربط Limitsiz Clinic الحجز والاستقبال والتوثيق والمالية في نظام واحد منسّق. يقضي فريقك وقتاً أقل في الأعمال الإدارية، ووقتاً أكبر مع مرضاه.",
    hero_btn1: "احجز عرضاً مجانياً", hero_btn2: "اطلع على طريقة العمل",
    hero_trust: "تبقى بيانات مرضاك في قاعدة بياناتك الخاصة.",

    problem_title: "الأعمال الإدارية تكلّف عيادتك مرضى ووقتاً.",
    problem_1: "المكالمات الفائتة ورسائل واتساب دون رد تترك المرضى في الانتظار، وبعضهم يحجز في مكان آخر.",
    problem_2: "جدولة المواعيد والتذكيرات والمتابعة اليدوية تستنزف يوم فريق الاستقبال.",
    problem_3: "يقضي الأطباء أمسياتهم في كتابة الملاحظات والتقارير بدلاً من الراحة.",
    problem_4: "تُتابَع الإيرادات والفواتير غير المسددة في جداول بيانات، إن تُتابَع أصلاً.",

    solution_title: "فريق واحد من وكلاء الذكاء الاصطناعي يعمل معاً.",
    solution_text: "معظم برامج العيادات تؤدي مهمة واحدة. يشغّل Limitsiz Clinic مجموعة من وكلاء الذكاء الاصطناعي المتخصصين، يتبادلون المعلومات ويسلّم بعضهم المهام لبعض. يتحول الحجز إلى تذكير، والزيارة إلى ملاحظة طبية، والدفعة إلى سجل مالي، دون إعادة كتابة البيانات يدوياً.",

    agents_title: "وكلاؤنا",
    agent_booking_title: "وكيل الحجز (واتساب)",
    agent_booking_text: "يحجز المرضى مواعيدهم ويعيدون جدولتها ويلغونها عبر واتساب، في أي وقت من اليوم. يتحقق الوكيل من مواعيدك المتاحة فعلياً ويرسل التذكيرات تلقائياً.",
    agent_recep_title: "موظف الاستقبال الذكي",
    agent_recep_text: "يجيب عن الأسئلة الشائعة حول الخدمات والأسعار وساعات العمل والموقع. يحوّل الحالات العاجلة أو المعقدة إلى فريقك مع ملخص للسياق.",
    agent_scribe_title: "المساعد الكتابي الذكي",
    agent_scribe_text: "يحوّل ملاحظات الاستشارة إلى توثيق طبي منظم. يراجع الطبيب كل ملاحظة ويعتمدها قبل حفظها.",
    agent_reports_title: "التقارير الطبية",
    agent_reports_text: "يُنشئ ملخصات الزيارات وتقارير المرضى خلال ثوانٍ، جاهزة لمراجعة الطبيب وتوقيعه.",
    agent_fin_title: "المالية في العيادة",
    agent_fin_text: "يتتبع الإيرادات اليومية والمدفوعات والفواتير غير المسددة وأداء الخدمات في لوحة واحدة.",
    agent_assist_title: "المساعد السريري",
    agent_assist_text: "يدعم الطبيب بالمعلومات المرجعية وقوائم التحقق أثناء الرعاية. الطبيب هو من يتخذ القرار السريري النهائي دائماً.",

    how_title: "كيف يعمل",
    step1_title: "1. الربط", step1_text: "اربط رقم واتساب وتقويم العيادة وأنظمتك الحالية. الإعداد موجَّه، ونتولى نحن الجانب التقني.",
    step2_title: "2. الضبط", step2_text: "أضف خدماتك وجداول الموظفين وأسعارك ونبرة صوت عيادتك. يتعلم الوكلاء سير عملك أنت، لا سيراً عاماً.",
    step3_title: "3. التنسيق", step3_text: "يعمل الوكلاء معاً على مدار الساعة. ترى كل شيء في مكان واحد، وتتدخل فقط حيث يحتاج الأمر إلى حكمك.",

    day_title: "يوم في العيادة",
    day_1: "<strong>8:12 ص.</strong> مريضة ترسل رسالة على واتساب تطلب موعد فحص. يعرض وكيل الحجز ثلاثة مواعيد ويؤكد الموعد الذي تختاره.",
    day_2: "<strong>11:40 ص.</strong> متصل يسأل عن الأسعار. يجيب موظف الاستقبال الذكي، ولا يحوّل المكالمة إلى الموظف إلا عند الحاجة.",
    day_3: "<strong>2:05 م.</strong> ينهي الطبيب استشارة. يُعد المساعد الكتابي المسودة، ويعتمدها الطبيب بنقرة واحدة.",
    day_4: "<strong>6:00 م.</strong> يحدّث وكيل المالية إيرادات اليوم، ويُبرز فاتورتين غير مسددتين للمتابعة.",
    day_outro: "عمل فريقك هو نفسه. الفرق أن شيئاً لم يضِع بين الفجوات.",

    security_title: "الأمان والخصوصية",
    security_headline: "بيانات مرضاك ملك لعيادتك.",
    sec_1_title: "قاعدة بياناتك", sec_1_text: "تُحفظ سجلات المرضى في قاعدة بيانات محلية أو سحابية تملكها، لا في مساحة تخزين لدى منصة طرف ثالث.",
    sec_2_title: "صلاحيات حسب الدور", sec_2_text: "يرى الموظفون ما يحتاجه دورهم فقط.",
    sec_3_title: "الطبيب في الحلقة", sec_3_text: "لا تصبح أي ملاحظة طبية أو تقرير نهائياً قبل اعتماد طبيب مرخّص.",
    sec_4_title: "التشفير", sec_4_text: "البيانات مشفّرة أثناء النقل وفي حالة التخزين.",
    sec_5_title: "استخدام البيانات بوضوح", sec_5_text: "لا تُستخدم بيانات المرضى لتدريب نماذج الذكاء الاصطناعي.",

    results_title: "نتائج مستهدفة",
    results_label: "أرقام مستهدفة، وليست نتائج مضمونة. ستُحدَّث بنتائج التجارب الفعلية.",
    res_1_num: "50–70%", res_1_text: "تراجع في المواعيد الفائتة بفضل التذكيرات التلقائية",
    res_2_num: "20 ساعة", res_2_text: "توفير أسبوعي في الأعمال الإدارية لفريق الاستقبال",
    res_3_num: "5–10 دقائق", res_3_text: "توفير لكل استشارة في التوثيق",
    res_4_text: "حجز وردود للمرضى، بما فيها خارج ساعات الدوام",

    pricing_title: "خطط بسيطة تنمو مع عيادتك.",
    pricing_note: "الأسعار بالدولار الأمريكي.",
    row_for: "مناسبة لـ", row_agents: "الوكلاء", row_support: "الدعم", row_price: "السعر",
    plan_starter: "الأساسية", plan_pro: "الاحترافية", plan_ent: "المؤسسات",
    starter_for: "عيادات بطبيب واحد", pro_for: "عيادات متعددة الأطباء", ent_for: "مجموعات العيادات",
    starter_agents: "الحجز، الاستقبال", pro_agents: "+ المساعد الكتابي، التقارير", ent_agents: "كل الوكلاء، إعداد مخصص",
    starter_support: "البريد الإلكتروني", pro_support: "دعم بأولوية", ent_support: "مدير مخصص",
    starter_price: "ابتداءً من 100 دولار/شهر", pro_price: "ابتداءً من 200 دولار/شهر", ent_price: "تواصل معنا",
    pricing_btn: "اطلب تجربة",

    faq_title: "الأسئلة الشائعة",
    faq_q1: "هل أحتاج إلى تغيير برنامجي الحالي؟",
    faq_a1: "لا. يتصل Limitsiz Clinic بالأدوات التي تستخدمها اليوم. نبدأ بما لديك، وننتقل بالوتيرة التي تناسبك.",
    faq_q2: "هل سيعرف المرضى أنهم يتحدثون مع ذكاء اصطناعي؟",
    faq_a2: "نعم. يعرّف وكيل الحجز وموظف الاستقبال نفسيهما بأنهما المساعد الذكي للعيادة، والحالات العاجلة تذهب دائماً إلى فريقك.",
    faq_q3: "هل يستطيع أطبائي تجاوز الذكاء الاصطناعي؟",
    faq_a3: "دائماً. يراجع الأطباء كل مخرج سريري ويعتمدونه. الذكاء الاصطناعي يدعم القرار ولا يتخذه.",
    faq_q4: "أين تُحفظ بياناتي؟",
    faq_a4: "في قاعدة بياناتك الخاصة، إما في مقر العيادة أو في حساب سحابي تتحكم فيه.",
    faq_q5: "كم يستغرق الإعداد؟",
    faq_a5: "عادةً من يوم إلى يومين.",
    faq_q6: "هل يدعم النظام العربية؟",
    faq_a6: "نعم. يستطيع المرضى الحجز وطرح الأسئلة بالعربية والإنجليزية.",

    contact_title: "هل أنت مستعد لإدارة عيادة أذكى؟",
    contact_text: "أخبرنا عن عيادتك، وسنريك بالتفصيل كيف يعمل الوكلاء في فريقك.",
    form_name: "الاسم الكامل", form_clinic: "اسم العيادة", form_email: "البريد الإلكتروني", form_phone: "الهاتف / واتساب",
    form_message: "رسالة (اختياري)",
    form_privacy: "بإرسال النموذج، فإنك توافق على <a href=\"privacy.html\">سياسة الخصوصية</a>.",
    form_submit: "اطلب عرضاً", form_sending: "جارٍ الإرسال…",
    form_success: "شكراً لك! استلمنا طلبك وسنتواصل معك قريباً.",
    form_error: "تعذّر إرسال الطلب. حاول مرة أخرى، أو راسلنا عبر البريد الإلكتروني مباشرة.",
    form_invalid: "يرجى إدخال الاسم وبريد إلكتروني صالح.",
    form_spam: "شكراً لك! استلمنا طلبك.",
    form_not_configured: "النموذج غير متصل بعد. يرجى مراسلتنا عبر البريد الإلكتروني مباشرة.",
    contact_direct: "أو تواصل معنا مباشرة:",

    footer_tagline: "وكلاء ذكاء اصطناعي منسّقون للعيادات الخاصة",
    footer_address: "عمّان، الأردن",
    footer_privacy: "سياسة الخصوصية", footer_terms: "الشروط والأحكام",
    copyright: "© 2026 Limitsiz Clinic. جميع الحقوق محفوظة.",

    draft_banner: "مسودة للمراجعة. بانتظار المراجعة القانونية قبل النشر.",
    priv_updated: "آخر تحديث: أكتوبر 2026",
    priv_title: "سياسة الخصوصية",
    priv_h1: "1. من نحن",
    priv_p1: "تقع Limitsiz Clinic في عمّان، الأردن. يمكنك التواصل معنا عبر management@limitsiz.si أو عبر واتساب على الرقم 00962-795016514.",
    priv_h2: "2. المعلومات التي نجمعها",
    priv_p2: "عند طلب عرض أو التواصل معنا، نجمع البيانات التي تقدمها: اسمك، واسم العيادة، والبريد الإلكتروني، ورقم الهاتف، وأي رسالة تكتبها. كما نجمع معلومات تقنية أساسية لازمة لتشغيل الموقع وتأمينه.",
    priv_h3: "3. كيف نستخدم المعلومات",
    priv_p3: "نستخدم معلوماتك للرد على طلبك، وترتيب العروض التوضيحية، وإخبارك بخدماتنا. لا نبيع معلوماتك الشخصية.",
    priv_h4: "4. مكان التخزين",
    priv_p4: "تُحفظ بيانات طلبات العرض والتواصل في قاعدة بيانات آمنة مستضافة على Supabase. ولا يصل إليها إلا أعضاء الفريق المصرّح لهم.",
    priv_h5: "5. بيانات المرضى",
    priv_p5: "لا يجمع هذا الموقع سجلات المرضى. تحتفظ العيادات التي تستخدم منتجنا ببيانات مرضاها في قاعدة بياناتها الخاصة، وتتحكم في من يصل إليها.",
    priv_h6: "6. مدة الاحتفاظ بالبيانات",
    priv_p6: "نحتفظ ببيانات الطلبات مدة لازمة للرد عليك والحفاظ على سجلاتنا التجارية. ويمكنك طلب حذف بياناتك في أي وقت.",
    priv_h7: "7. حقوقك",
    priv_p7: "يحق لك طلب الاطلاع على معلوماتك الشخصية أو تصحيحها أو حذفها، أو طلب وقف التواصل معك. راسلنا على management@limitsiz.si وسنرد عليك.",
    priv_h8: "8. التغييرات على هذه السياسة",
    priv_p8: "قد نحدّث هذه السياسة من وقت لآخر. يوضح التاريخ في أعلى الصفحة آخر نسخة.",

    terms_title: "شروط الاستخدام",
    terms_h1: "1. استخدام هذا الموقع",
    terms_p1: "يحق لك استخدام هذا الموقع للأغراض المشروعة فقط. يُمنع محاولة تعطيل الموقع أو إلحاق الضرر به أو الوصول غير المصرّح به إلى أنظمته.",
    terms_h2: "2. معلومات وليست نصيحة طبية",
    terms_p2: "يصف المحتوى المعروض في هذا الموقع برامجنا وخدماتنا. وهو معلومات عامة وليس نصيحة طبية. تبقى القرارات السريرية مسؤولية مختصين صحيين مرخّصين.",
    terms_h3: "3. الخدمات",
    terms_p3: "تُقدَّم خدماتنا بموجب اتفاقية كتابية منفصلة. وقد تتغير الميزات والأسعار والأهداف المعروضة في هذا الموقع، والنتائج المذكورة أهداف وليست ضمانات.",
    terms_h4: "4. الملكية الفكرية",
    terms_p4: "المحتوى والتصميم والبرمجيات في هذا الموقع مملوكة لـ Limitsiz Clinic أو لمرخّصيها. لا يجوز نسخها أو إعادة استخدامها دون إذن كتابي.",
    terms_h5: "5. حدود المسؤولية",
    terms_p5: "إلى الحد الذي يسمح به القانون، يُقدَّم الموقع \"كما هو\"، ولا نتحمل المسؤولية عن الخسائر غير المباشرة أو التبعية الناتجة عن استخدامه.",
    terms_h6: "6. القانون الواجب التطبيق",
    terms_p6: "تخضع هذه الشروط لقوانين المملكة الأردنية الهاشمية. [بانتظار تأكيد المستشار القانوني.]",
    terms_h7: "7. التواصل",
    terms_p7: "للاستفسار عن هذه الشروط: management@limitsiz.si."
  };

  /* 2026-10 redesign ("infinite intelligence"): new and updated strings */
  var EN_V2 = {
    nav_solutions: "Agents", nav_how: "How it works", nav_demo: "Book a demo",
    hero_eyebrow: "Infinite intelligence for private clinics",
    hero_title: "Your clinic,<br>without limits.",
    hero_btn1: "Book a free demo", hero_btn2: "See how it works",
    hero_card_label: "8:12 AM · BOOKING AGENT",
    hero_card_text: "Check-up confirmed for Thursday at 10:30. A reminder will go out the day before.",
    hero_art_label: "Six AI agents connected on one continuous infinity loop",
    tick_1: "WhatsApp booking", tick_2: "Reminders", tick_3: "Front desk", tick_4: "Clinical notes",
    tick_5: "Reports", tick_6: "Revenue", tick_7: "Arabic + English",
    lbl_problem: "01 — The problem", lbl_agents: "02 — The agents", lbl_practice: "In practice",
    lbl_how: "03 — How it works", lbl_day: "04 — A day in the clinic", lbl_security: "05 — Security and privacy",
    lbl_results: "06 — Target outcomes", lbl_pricing: "07 — Pricing", lbl_faq: "08 — FAQ",
    agents_sub: "Most clinic software does one job. Limitsiz Clinic runs specialized agents that share information and hand tasks to each other.",
    agent_booking_title: "Booking Agent",
    chat_1: "Hi, can I book a check-up this week?",
    chat_2: "Of course. Tuesday 4:00, Wednesday 11:15 or Thursday 10:30?",
    chat_3: "Thursday please.",
    chat_meta: "Confirmed · reminder scheduled",
    scribe_note: "Visit note · draft ready", scribe_approve: "APPROVE",
    orch_label: "Orchestrated",
    orch_text: "A booking becomes a reminder, a visit becomes a note, a note becomes an invoice.",
    practice_title: "Built for the people in the room.",
    practice_text: "Your team stays with patients. The agents work quietly in the background.",
    photo_1_alt: "Receptionist at a clinic front desk showing a patient the booking screen on a tablet",
    photo_2_alt: "Doctor reviewing a visit note on a laptop in his consultation room",
    photo_3_alt: "Patient at home in the evening booking an appointment on WhatsApp",
    photo_3_tag: "Booking Agent",
    how_title: "Set up once. It keeps running.",
    step1_title: "Connect", step2_title: "Configure", step3_title: "Orchestrate",
    day_title: "Nothing falls through the cracks.",
    day_1: "A patient asks on WhatsApp for a check-up. The Booking Agent offers three slots and confirms her choice.",
    day_2: "A caller asks about pricing. The Receptionist answers and passes the call to staff only when a person is needed.",
    day_3: "The doctor finishes a consultation. The Scribe drafts the note, and the doctor approves it in one click.",
    day_4: "Financials updates the day's revenue and flags two unpaid invoices for follow-up.",
    am: " AM", pm: " PM",
    security_sub: "Intelligence without limits, inside limits you set.",
    results_title: "What we are aiming for.",
    res_2_num: "20 h",
    per_month: " from / month",
    starter_agents: "Booking + Receptionist", starter_support: "Email support",
    pro_agents: "Starter agents + Scribe and Reports", pro_support: "Priority support",
    ent_price: "Let's talk", ent_btn: "Contact us",
    pricing_btn: "Request a trial",
    faq_title: "Questions clinics ask us.",
    fix_first: "What should we fix first?",
    topic_1: "Missed calls", topic_2: "Scheduling", topic_3: "Documentation", topic_4: "Reports", topic_5: "Finance",
    ch_wa: "Message us on WhatsApp", ch_email: "Email the team",
    form_submit: "Request a demo",
    footer_terms: "Terms of Use",
    copyright: "© 2026 Limitsiz. All rights reserved."
  };
  var AR_V2 = {
    nav_solutions: "الوكلاء", nav_how: "كيف يعمل", nav_demo: "احجز عرضاً",
    hero_eyebrow: "ذكاء بلا حدود للعيادات الخاصة",
    hero_title: "عيادتك،<br>بلا حدود.",
    hero_btn1: "احجز عرضاً مجانياً", hero_btn2: "شاهد كيف يعمل",
    hero_card_label: "8:12 ص · وكيل الحجز",
    hero_card_text: "تم تأكيد موعد الفحص يوم الخميس الساعة 10:30. سيصلك تذكير قبل الموعد بيوم.",
    hero_art_label: "ستة وكلاء ذكاء اصطناعي متصلون في حلقة لا نهائية واحدة",
    tick_1: "الحجز عبر واتساب", tick_2: "التذكيرات", tick_3: "الاستقبال", tick_4: "الملاحظات السريرية",
    tick_5: "التقارير", tick_6: "الإيرادات", tick_7: "العربية والإنجليزية",
    lbl_problem: "01 — المشكلة", lbl_agents: "02 — الوكلاء", lbl_practice: "على أرض الواقع",
    lbl_how: "03 — كيف يعمل", lbl_day: "04 — يوم في العيادة", lbl_security: "05 — الأمان والخصوصية",
    lbl_results: "06 — النتائج المستهدفة", lbl_pricing: "07 — الأسعار", lbl_faq: "08 — الأسئلة الشائعة",
    agents_sub: "معظم برامج العيادات تؤدي مهمة واحدة. أما Limitsiz Clinic فتشغّل وكلاء متخصصين يتبادلون المعلومات ويسلّمون المهام لبعضهم.",
    agent_booking_title: "وكيل الحجز",
    chat_1: "مرحباً، هل يمكنني حجز فحص هذا الأسبوع؟",
    chat_2: "بالتأكيد. الثلاثاء 4:00، أو الأربعاء 11:15، أو الخميس 10:30؟",
    chat_3: "الخميس من فضلك.",
    chat_meta: "تم التأكيد · تمت جدولة التذكير",
    scribe_note: "ملاحظة الزيارة · المسودة جاهزة", scribe_approve: "اعتماد",
    orch_label: "منسّق",
    orch_text: "الحجز يصبح تذكيراً، والزيارة تصبح ملاحظة، والملاحظة تصبح فاتورة.",
    practice_title: "مصمَّم للأشخاص داخل العيادة.",
    practice_text: "فريقك يبقى مع المرضى، والوكلاء يعملون بهدوء في الخلفية.",
    photo_1_alt: "موظفة استقبال في العيادة تعرض على مريض شاشة الحجز على جهاز لوحي",
    photo_2_alt: "طبيب يراجع ملاحظة الزيارة على حاسوب محمول في غرفة الكشف",
    photo_3_alt: "مريض في منزله مساءً يحجز موعداً عبر واتساب",
    photo_3_tag: "وكيل الحجز",
    how_title: "إعداد مرة واحدة، وعمل لا يتوقف.",
    step1_title: "الربط", step2_title: "الإعداد", step3_title: "التنسيق",
    day_title: "لا شيء يضيع.",
    day_1: "مريضة تطلب فحصاً عبر واتساب. يعرض وكيل الحجز ثلاثة مواعيد ويؤكد اختيارها.",
    day_2: "متصل يسأل عن الأسعار. يجيب موظف الاستقبال الذكي ويحوّل المكالمة للفريق فقط عند الحاجة إلى شخص.",
    day_3: "ينهي الطبيب الكشف. يكتب الكاتب الذكي مسودة الملاحظة، ويعتمدها الطبيب بنقرة واحدة.",
    day_4: "يحدّث وكيل المالية إيرادات اليوم وينبّه إلى فاتورتين غير مدفوعتين للمتابعة.",
    am: " ص", pm: " م",
    security_sub: "ذكاء بلا حدود، ضمن حدود تضعها أنت.",
    results_title: "ما نسعى إلى تحقيقه.",
    res_2_num: "20 ساعة",
    per_month: " يبدأ من / شهرياً",
    starter_agents: "الحجز + الاستقبال", starter_support: "دعم عبر البريد الإلكتروني",
    pro_agents: "وكلاء الباقة الأساسية + الكاتب والتقارير", pro_support: "دعم ذو أولوية",
    ent_price: "لنتحدث", ent_btn: "تواصل معنا",
    pricing_btn: "اطلب تجربة",
    faq_title: "أسئلة تطرحها علينا العيادات.",
    fix_first: "ما الذي نبدأ بإصلاحه أولاً؟",
    topic_1: "المكالمات الفائتة", topic_2: "الجدولة", topic_3: "التوثيق", topic_4: "التقارير", topic_5: "المالية",
    ch_wa: "راسلنا على واتساب", ch_email: "راسل الفريق بالبريد",
    form_submit: "اطلب عرضاً",
    footer_terms: "شروط الاستخدام",
    copyright: "© 2026 Limitsiz. جميع الحقوق محفوظة."
  };
  Object.keys(EN_V2).forEach(function (k) { EN[k] = EN_V2[k]; });
  Object.keys(AR_V2).forEach(function (k) { AR[k] = AR_V2[k]; });

  var DICT = { en: EN, ar: AR };
  var TITLES = {
    "index.html": { en: "Limitsiz Clinic | Orchestrated AI Agents for Private Clinics", ar: "Limitsiz Clinic | وكلاء ذكاء اصطناعي منسّقون للعيادات الخاصة" },
    "privacy.html": { en: "Privacy Policy | Limitsiz Clinic", ar: "سياسة الخصوصية | Limitsiz Clinic" },
    "terms.html": { en: "Terms of Use | Limitsiz Clinic", ar: "شروط الاستخدام | Limitsiz Clinic" }
  };

  function currentPage() {
    var p = (location.pathname.split("/").pop() || "index.html");
    return TITLES[p] ? p : "index.html";
  }

  function getSavedLang() {
    try {
      var s = localStorage.getItem("lc_lang");
      if (s === "en" || s === "ar") return s;
    } catch (e) { /* storage unavailable (private mode) */ }
    return (navigator.language || "").toLowerCase().indexOf("ar") === 0 ? "ar" : "en";
  }

  function saveLang(lang) {
    try { localStorage.setItem("lc_lang", lang); } catch (e) { /* ignore */ }
  }

  function t(key, lang) {
    var l = lang || document.documentElement.lang || "en";
    var d = DICT[l] || EN;
    return d[key] !== undefined ? d[key] : (EN[key] !== undefined ? EN[key] : key);
  }

  function applyLang(lang) {
    var dict = DICT[lang] || EN;
    var html = document.documentElement;
    html.lang = lang;
    html.dir = lang === "ar" ? "rtl" : "ltr";

    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (dict[key] !== undefined) el.textContent = dict[key];
    });
    document.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-html");
      if (dict[key] !== undefined) el.innerHTML = dict[key];
    });
    document.querySelectorAll("[data-i18n-alt]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-alt");
      if (dict[key] !== undefined) el.setAttribute("alt", dict[key]);
    });
    document.querySelectorAll("[data-i18n-aria]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-aria");
      if (dict[key] !== undefined) el.setAttribute("aria-label", dict[key]);
    });

    document.title = TITLES[currentPage()][lang];
    var meta = document.querySelector('meta[name="description"]');
    if (meta && lang === "ar") meta.setAttribute("content", "تربط Limitsiz Clinic الحجز والاستقبال والتوثيق والمالية في نظام واحد منسّق للعيادات الخاصة.");
    if (meta && lang === "en") meta.setAttribute("content", "Limitsiz Clinic connects booking, reception, documentation and finance into one coordinated system for private clinics.");

    var btn = document.getElementById("langToggle");
    if (btn) {
      btn.textContent = lang === "ar" ? "English" : "العربية";
      btn.setAttribute("aria-label", lang === "ar" ? "Switch to English" : "التبديل إلى العربية");
    }
  }

  function init() {
    applyLang(getSavedLang());
    var btn = document.getElementById("langToggle");
    if (btn) {
      btn.addEventListener("click", function () {
        var next = document.documentElement.lang === "ar" ? "en" : "ar";
        saveLang(next);
        applyLang(next);
      });
    }
  }

  window.LC_I18N = { t: t, applyLang: applyLang };
  window.t = t;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
