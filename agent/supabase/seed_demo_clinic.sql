-- Demo dermatology clinic for building and testing the agent. Not a real clinic:
-- names, prices and hours are placeholders until a pilot clinic gives us its own.
-- Fixed IDs so tests and the chat simulator can refer to them. Safe to run again (it replaces the demo).

delete from clinics where slug = 'demo-derma';

insert into clinics (id, slug, name_en, name_ar, phone, address_en, address_ar, default_language)
values ('00000000-0000-4000-8000-000000000001', 'demo-derma',
        'Limitsiz Demo Dermatology', 'عيادة Limitsiz التجريبية للجلدية',
        '+962790000000',
        'Demo address, Abdoun, Amman', 'عنوان تجريبي، عبدون، عمّان',
        'ar');

insert into doctors (id, clinic_id, name_en, name_ar, title_en, title_ar, gender) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-000000000001',
   'Dr. Lina Haddad', 'د. لينا حداد', 'Consultant Dermatologist', 'استشارية الأمراض الجلدية', 'f'),
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-000000000001',
   'Dr. Omar Khalil', 'د. عمر خليل', 'Dermatologist', 'أخصائي الأمراض الجلدية', 'm');

insert into services (id, clinic_id, name_en, name_ar, duration_minutes, price_jod, price_is_from, sort) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000001',
   'Dermatology consultation', 'استشارة جلدية', 20, 30, false, 1),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-000000000001',
   'Follow-up visit', 'زيارة متابعة', 15, 15, false, 2),
  ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-000000000001',
   'Laser hair removal session', 'جلسة إزالة الشعر بالليزر', 30, 40, true, 3),
  ('00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-000000000001',
   'Chemical peel', 'تقشير كيميائي', 45, 60, true, 4),
  ('00000000-0000-4000-8000-0000000000b5', '00000000-0000-4000-8000-000000000001',
   'Acne treatment session', 'جلسة علاج حب الشباب', 30, 35, true, 5);

-- Dr. Lina does everything; Dr. Omar does consultations, follow-ups and laser.
insert into doctor_services (clinic_id, doctor_id, service_id)
select '00000000-0000-4000-8000-000000000001', d, s
from (values
  ('00000000-0000-4000-8000-0000000000d1'::uuid, '00000000-0000-4000-8000-0000000000b1'::uuid),
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000b2'),
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000b3'),
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000b4'),
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000b5'),
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000b1'),
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000b2'),
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000b3')
) as t (d, s);

-- Friday closed. Dr. Lina: Saturday to Thursday 10:00-14:00 and 16:00-19:00 (split shift).
-- Dr. Omar: Sunday to Thursday 12:00-20:00.
insert into working_hours (clinic_id, doctor_id, weekday, start_time, end_time)
select '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000d1', w, s, e
from unnest(array[6, 0, 1, 2, 3, 4]) as w,
     (values ('10:00'::time, '14:00'::time), ('16:00', '19:00')) as h (s, e);

insert into working_hours (clinic_id, doctor_id, weekday, start_time, end_time)
select '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000d2', w, '12:00', '20:00'
from unnest(array[0, 1, 2, 3, 4]) as w;

insert into clinic_faqs (clinic_id, topic, question_en, question_ar, answer_en, answer_ar, sort) values
  ('00000000-0000-4000-8000-000000000001', 'location',
   'Where is the clinic?', 'أين تقع العيادة؟',
   'We are in Abdoun, Amman. Free parking is available in front of the building.',
   'نحن في عبدون، عمّان، ويتوفر موقف مجاني أمام المبنى.', 1),
  ('00000000-0000-4000-8000-000000000001', 'payment',
   'How can I pay?', 'ما طرق الدفع المتاحة؟',
   'Cash, card, and CliQ are accepted at the clinic.',
   'نقبل الدفع نقداً أو بالبطاقة أو عبر CliQ في العيادة.', 2),
  ('00000000-0000-4000-8000-000000000001', 'insurance',
   'Do you accept insurance?', 'هل تقبلون التأمين؟',
   'We accept several insurance plans for consultations. Please send a photo of your insurance card and our team will confirm coverage before your visit. Cosmetic treatments are not covered.',
   'نقبل عدداً من شركات التأمين للاستشارات. يرجى إرسال صورة بطاقة التأمين وسيؤكد فريقنا التغطية قبل موعدك. العلاجات التجميلية غير مشمولة بالتأمين.', 3),
  ('00000000-0000-4000-8000-000000000001', 'preparation',
   'How should I prepare for laser hair removal?', 'كيف أستعد لجلسة الليزر؟',
   'Shave the area 24 hours before, and avoid sun exposure and waxing for two weeks before the session.',
   'احلق المنطقة قبل الجلسة بـ 24 ساعة، وتجنب التعرض للشمس وإزالة الشعر بالشمع قبل الجلسة بأسبوعين.', 4),
  ('00000000-0000-4000-8000-000000000001', 'cancellation',
   'Can I cancel or change my appointment?', 'هل يمكنني إلغاء موعدي أو تغييره؟',
   'Yes, up to 2 hours before your appointment, right here on WhatsApp.',
   'نعم، حتى ساعتين قبل الموعد، هنا عبر واتساب.', 5);
