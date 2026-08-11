/**
 * GLSL compartilhado pela projeção Presença.
 *
 * Mora num módulo próprio porque agora tem MAIS DE UM consumidor: a entidade
 * (a pedra e o encante) e as fitas. Ruído duplicado entre dois shaders é a
 * receita para eles divergirem em silêncio — a pedra ondulando com um campo e
 * a fita com outro, sem que nada no código diga que deveriam concordar.
 * Um fato, um lugar.
 */

/* ------------------------------------------------------------------------- */
/* GLSL compartilhado                                                        */
/* ------------------------------------------------------------------------- */

export const GLSL_COMUM = /* glsl */ `
float hash(vec3 p){ p=fract(p*0.3183099+vec3(0.1,0.2,0.3)); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 p){
  vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),
                 mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                 mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p){ float v=0., a=0.5; for(int i=0;i<3;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
/* O campo que dá forma à pedra — e a diferença entre pedra bruta e cromo
   líquido.

   Era fbm puro: três oitavas de peso 0,57 / 0,29 / 0,14 a partir de 1,5. Em
   escala de esfera unitária isso põe a oitava mais fina em ~6 ciclos por raio,
   com um sétimo da amplitude total — e é exatamente essa oitava que aparecia
   como caroço. Muitos lóbulos pequenos não leem como líquido: leem como pedra
   lascada, que foi o diagnóstico.

   Três mudanças, todas na direção da referência:

    · a frequência base cai de 1,5 para 1,12. Menos dobras, maiores: em 1,12 o
      período do ruído é ~0,9, o que dá sete dobras no equador de uma esfera
      unitária. É o que a referência mostra — numa gota de metal líquido cabem
      seis ou sete dobras, não vinte.

      (Foi tentado 0,82, que dá cinco. Não funciona, e a razão é geométrica: o
      relevo PERCEBIDO depende da curvatura, que vai com amplitude × frequência
      ao quadrado. Cortar a frequência pela metade custa quatro vezes o relevo
      visível, e a peça chega à tela quase esférica — o extremo oposto do
      "bruto", e igualmente errado.)
    · o espectro decai mais rápido (0,70 / 0,24 / 0,06). A oitava fina deixa de
      esculpir e passa a apenas insinuar — é sulco, não caroço. Foi ela que
      punha canto anguloso na silhueta: numa peça de tensão superficial não
      existe aresta, e uma oitava alta com peso de um décimo já basta para
      produzir uma;
    · o domínio é dobrado antes de ser amostrado. Deformar o espaço onde o
      ruído mora é o que faz a dobra ESCORRER em vez de ondular: sem isso o
      relevo é simétrico e imóvel de caráter, com isso ele ganha o redemoinho
      que toda a referência tem.

   A curva final, n*n*(3-2n), é o acabamento: comprime os extremos e inclina o
   meio, o que devolve cristas largas e arredondadas separadas por vales
   estreitos. É a assinatura de tensão superficial — o que separa uma gota de
   uma batata.

   Média e faixa são preservadas: os pesos somam 1 e a curva é simétrica em
   0,5. Logo (campo - 0,5) * uDeform * 2 continua no mesmo intervalo de antes,
   e o RAIO_MAXIMO_RIG do estudio continua valendo sem recontar. */
float campoPedra(vec3 p, vec3 off){
  float w = noise(p*0.78 + off*0.8 + 5.0);
  vec3 q = p + (w - 0.5)*0.9;
  float n = noise(q*1.12 + off)*0.70
          + noise(q*2.37 + off*1.31 + 17.0)*0.24
          + noise(q*4.85 + off*0.53 + 41.0)*0.06;
  return n*n*(3.0 - 2.0*n);
}
vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz)*6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
/* Radiância, não valor de tela.
   A cor da aurora e do encante foi afinada quando o shader escrevia direto no
   canvas sRGB — o número saía como o olho o via. Com a composição no meio, o
   quadro inteiro é linear até o passe de lente, e escrever o mesmo número ali
   estoura tudo (foi exatamente o que aconteceu: chapado pastel com borda dura,
   que é o formato do corte de faixa). Esta conversão devolve o valor afinado
   para radiância; a curva do sensor o traz de volta ao mesmo lugar, agora com
   o joelho de filme no alto em vez de tesoura.

   O grau não é sempre 2,2. A conversão exata devolve a luminância, mas também
   devolve a saturação que o corte antigo lavava: a aurora vinha pastel porque
   estourava, e em 2,2 ela reaparece azul-marinho e vinho — outra cor, não
   outra exposição. 1,5 é o meio-termo que preserva o pastel da identidade. O
   encante não tem esse problema e usa a conversão inteira. */
vec3 paraLinear(vec3 c, float grau){ return pow(max(c, vec3(0.0)), vec3(grau)); }
`;

/**
 * Espectro da entidade — reescrito em 11/08 junto com a PALETA GRAFITE.
 *
 * Era menta → azul → lilás → laranja → âmbar, em saturação quase plena: o
 * espectro da identidade "água" de 10/08. Ao lado de uma peça de cromo sobre
 * laca preta, esse verde não tem de onde vir. Não é uma cor da marca — é uma
 * cor de uma marca anterior, e é exatamente o que se enxerga como arbitrário.
 *
 * O que substitui não é "menos cor": é a cor que ESTE material produz. Filme
 * fino sobre metal polido percorre aço → azul → violeta → champanhe, e nunca
 * passa pelo verde-menta. A aurora continua sendo o único lugar policromático
 * do produto — só que agora a policromia dela é a da própria peça, e não a de
 * um sistema de cores que o produto abandonou.
 *
 * As paradas já nascem dessaturadas (nenhum canal abaixo de 0,43) porque o
 * trabalho de sobriedade tem que ser feito na paleta, não num filtro de
 * dessaturação no fim — filtro tira o berro mas também tira a diferença entre
 * um estado e outro, e é a diferença que carrega informação.
 */
export const GLSL_PALETA = /* glsl */ `
vec3 paletaMarca(float t){
  /* O aço tem que ser NEUTRO com viés azul, e o verde tem que sair já daqui.
     Em (0.78, 0.843, 0.902) o verde estava acima do vermelho e a parada lia
     ciano — e o quadrado logo adiante afasta os canais, então o que era ciano
     discreto chegava à tela esverdeado. Com o verde entre os outros dois, a
     mesma parada continua fria e para de puxar para o verde. */
  vec3 aco       = vec3(0.816, 0.847, 0.894);
  /* Azul PRATA, não azul saturado, e o motivo é a curva do sensor.
     Uma parada com azul muito acima dos outros dois canais (era 0,90 contra
     0,48 de vermelho) atravessa o ACES do passe de lente e sai puxada para o
     ciano — é um desvio conhecido da curva com azuis saturados, e foi ele que
     manteve a cortina verde mesmo depois de o verde ter saído da paleta.
     Fechando a distância entre os canais, o mesmo azul sobrevive à curva. */
  vec3 azul      = vec3(0.596, 0.686, 0.882);
  vec3 violeta   = vec3(0.702, 0.643, 0.863);
  vec3 champanhe = vec3(0.925, 0.863, 0.769);
  t = fract(t);
  vec3 c = mix(aco, azul, smoothstep(0.0, 0.30, t));
  c = mix(c, violeta, smoothstep(0.30, 0.58, t));
  c = mix(c, champanhe, smoothstep(0.58, 0.80, t));
  c = mix(c, aco, smoothstep(0.80, 1.0, t));
  return c;
}
`;
